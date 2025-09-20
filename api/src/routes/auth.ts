import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticateToken, generateToken, AuthRequest, optionalAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../middleware/errorHandler';
import { pool } from '../config/database';
import { cache, redis } from '../config/redis';
import { log } from '../utils/logger';

const router = Router();

// Interfaces
interface LoginRequest {
  workspaceId: string;
  userId: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

interface TokenResponse {
  token: string;
  expiresIn: string;
  user: {
    userId: string;
    workspaceId: string;
    username?: string;
    role?: string;
    subscription?: string;
  };
}

interface ApiKeyRequest {
  name: string;
  permissions?: string[];
  expiresAt?: string;
}

// Login with workspace credentials
router.post(
  '/login',
  authRateLimiter,
  [
    body('workspaceId')
      .notEmpty().withMessage('Workspace ID is required')
      .isLength({ min: 3, max: 50 }).withMessage('Invalid workspace ID'),
    body('userId')
      .notEmpty().withMessage('User ID is required')
      .isLength({ min: 1, max: 50 }).withMessage('Invalid user ID'),
    body('username')
      .optional()
      .isLength({ min: 1, max: 100 }).withMessage('Invalid username'),
    body('password')
      .optional()
      .isLength({ min: 1 }).withMessage('Password cannot be empty'),
    body('apiKey')
      .optional()
      .isLength({ min: 10 }).withMessage('Invalid API key format'),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId, userId, username, password, apiKey }: LoginRequest = req.body;

    try {
      // Check if workspace exists and is active
      const workspaceResult = await pool.query(
        `SELECT id, subscription_tier, status
         FROM workspace_subscriptions
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      if (workspaceResult.rows.length === 0) {
        return res.status(401).json({
          error: 'Invalid credentials',
          message: 'Workspace not found',
        });
      }

      const workspace = workspaceResult.rows[0];

      if (workspace.status !== 'active') {
        return res.status(403).json({
          error: 'Workspace inactive',
          message: 'This workspace is not active',
        });
      }

      let userRole = 'user';

      // Authenticate with API key or password
      if (apiKey) {
        const apiResult = await pool.query(
          `SELECT workspace_id, permissions, expires_at
           FROM api_keys
           WHERE key_hash = crypt($1, key_hash)
           AND workspace_id = $2
           AND is_active = true`,
          [apiKey, workspaceId]
        );

        if (apiResult.rows.length === 0) {
          return res.status(401).json({
            error: 'Invalid credentials',
            message: 'Invalid API key',
          });
        }

        const apiKeyData = apiResult.rows[0];

        // Check if API key is expired
        if (apiKeyData.expires_at && new Date(apiKeyData.expires_at) < new Date()) {
          return res.status(401).json({
            error: 'API key expired',
            message: 'The provided API key has expired',
          });
        }

        userRole = 'api';
      } else if (password) {
        // For demo purposes - in real implementation, integrate with Rocket.Chat auth
        // This is a placeholder authentication
        if (password !== process.env.DEMO_PASSWORD) {
          return res.status(401).json({
            error: 'Invalid credentials',
            message: 'Invalid username or password',
          });
        }
      } else {
        return res.status(400).json({
          error: 'Authentication method required',
          message: 'Provide either password or apiKey',
        });
      }

      // Generate JWT token
      const token = generateToken({
        userId,
        workspaceId,
        username,
        role: userRole,
        subscription: workspace.subscription_tier,
      });

      // Store session info in Redis
      const sessionKey = `session:${workspaceId}:${userId}`;
      await cache.set(sessionKey, {
        userId,
        workspaceId,
        username,
        role: userRole,
        loginAt: new Date().toISOString(),
      }, 24 * 3600); // 24 hours

      // Log successful login
      log.info('User logged in', {
        userId,
        workspaceId,
        username,
        role: userRole,
        method: apiKey ? 'api_key' : 'password',
      });

      const response: TokenResponse = {
        token,
        expiresIn: process.env.JWT_EXPIRY || '24h',
        user: {
          userId,
          workspaceId,
          username,
          role: userRole,
          subscription: workspace.subscription_tier,
        },
      };

      res.json(response);
    } catch (error) {
      log.error('Login error', { workspaceId, userId, error });
      res.status(500).json({
        error: 'Authentication failed',
        message: 'An error occurred during authentication',
      });
    }
  })
);

// Logout (invalidate token)
router.post(
  '/logout',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, workspaceId } = req.user!;

    try {
      // Remove session from Redis
      const sessionKey = `session:${workspaceId}:${userId}`;
      await cache.delete(sessionKey);

      // Add token to blacklist (optional - for enhanced security)
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (token) {
        const tokenKey = `blacklist:${token}`;
        await cache.set(tokenKey, 'true', 24 * 3600); // Blacklist for token lifetime
      }

      log.info('User logged out', { userId, workspaceId });

      res.json({
        message: 'Logged out successfully',
      });
    } catch (error) {
      log.error('Logout error', { userId, workspaceId, error });
      res.status(500).json({
        error: 'Logout failed',
        message: 'An error occurred during logout',
      });
    }
  })
);

// Refresh token
router.post(
  '/refresh',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, workspaceId, username, role, subscription } = req.user!;

    try {
      // Verify session still exists
      const sessionKey = `session:${workspaceId}:${userId}`;
      const session = await cache.get(sessionKey);

      if (!session) {
        return res.status(401).json({
          error: 'Session expired',
          message: 'Please log in again',
        });
      }

      // Generate new token
      const newToken = generateToken({
        userId,
        workspaceId,
        username,
        role,
        subscription,
      });

      // Update session timestamp
      await cache.set(sessionKey, {
        ...session,
        refreshedAt: new Date().toISOString(),
      }, 24 * 3600);

      const response: TokenResponse = {
        token: newToken,
        expiresIn: process.env.JWT_EXPIRY || '24h',
        user: {
          userId,
          workspaceId,
          username,
          role,
          subscription,
        },
      };

      res.json(response);
    } catch (error) {
      log.error('Token refresh error', { userId, workspaceId, error });
      res.status(500).json({
        error: 'Token refresh failed',
        message: 'An error occurred while refreshing token',
      });
    }
  })
);

// Get current user info
router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, workspaceId, username, role, subscription } = req.user!;

    try {
      // Get additional user info from database
      const userResult = await pool.query(
        `SELECT up.*, ws.subscription_tier, ws.status as workspace_status
         FROM user_preferences up
         RIGHT JOIN workspace_subscriptions ws ON up.workspace_id = ws.workspace_id
         WHERE up.user_id = $1 AND up.workspace_id = $2`,
        [userId, workspaceId]
      );

      const userData = userResult.rows[0] || {};

      res.json({
        user: {
          userId,
          workspaceId,
          username,
          role,
          subscription: subscription || userData.subscription_tier,
        },
        preferences: userData.user_id ? {
          sourceLanguage: userData.source_language,
          targetLanguage: userData.target_language,
          qualityTier: userData.quality_tier,
          autoTranslate: userData.auto_translate,
          showOriginalHover: userData.show_original_hover,
          enabled: userData.enabled,
        } : null,
        workspace: {
          status: userData.workspace_status,
          subscriptionTier: userData.subscription_tier,
        },
      });
    } catch (error) {
      log.error('Get user info error', { userId, workspaceId, error });
      res.status(500).json({
        error: 'Failed to get user info',
        message: 'An error occurred while fetching user information',
      });
    }
  })
);

// Create API key
router.post(
  '/api-keys',
  authenticateToken,
  [
    body('name')
      .notEmpty().withMessage('API key name is required')
      .isLength({ max: 100 }).withMessage('Name too long'),
    body('permissions')
      .optional()
      .isArray().withMessage('Permissions must be an array'),
    body('expiresAt')
      .optional()
      .isISO8601().withMessage('Invalid expiration date'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { userId, workspaceId, role } = req.user!;
    const { name, permissions = ['translate'], expiresAt }: ApiKeyRequest = req.body;

    // Only admins can create API keys
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'Only admins can create API keys',
      });
    }

    try {
      // Generate API key
      const apiKey = `ut_${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = await bcrypt.hash(apiKey, 10);

      // Store API key in database
      const result = await pool.query(
        `INSERT INTO api_keys
         (workspace_id, name, key_hash, permissions, expires_at, created_by)
         VALUES ($1, $2, crypt($3, gen_salt('bf')), $4, $5, $6)
         RETURNING id, created_at`,
        [
          workspaceId,
          name,
          apiKey,
          JSON.stringify(permissions),
          expiresAt || null,
          userId,
        ]
      );

      log.info('API key created', {
        workspaceId,
        userId,
        keyId: result.rows[0].id,
        name,
      });

      res.status(201).json({
        id: result.rows[0].id,
        name,
        apiKey, // Only returned once during creation
        permissions,
        expiresAt,
        createdAt: result.rows[0].created_at,
        message: 'Store this API key securely. It will not be shown again.',
      });
    } catch (error) {
      log.error('API key creation error', { workspaceId, userId, error });
      res.status(500).json({
        error: 'Failed to create API key',
        message: 'An error occurred while creating the API key',
      });
    }
  })
);

// List API keys
router.get(
  '/api-keys',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, role } = req.user!;

    // Only admins can list API keys
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'Only admins can view API keys',
      });
    }

    try {
      const result = await pool.query(
        `SELECT id, name, permissions, expires_at, is_active, created_by, created_at, last_used_at
         FROM api_keys
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      const apiKeys = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        permissions: JSON.parse(row.permissions || '[]'),
        expiresAt: row.expires_at,
        isActive: row.is_active,
        createdBy: row.created_by,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        status: row.expires_at && new Date(row.expires_at) < new Date() ? 'expired' :
                row.is_active ? 'active' : 'inactive',
      }));

      res.json({ apiKeys });
    } catch (error) {
      log.error('List API keys error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to list API keys',
        message: 'An error occurred while fetching API keys',
      });
    }
  })
);

// Revoke API key
router.delete(
  '/api-keys/:keyId',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { keyId } = req.params;
    const { userId, workspaceId, role } = req.user!;

    // Only admins can revoke API keys
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'Only admins can revoke API keys',
      });
    }

    try {
      const result = await pool.query(
        `UPDATE api_keys
         SET is_active = false, revoked_at = CURRENT_TIMESTAMP, revoked_by = $1
         WHERE id = $2 AND workspace_id = $3
         RETURNING name`,
        [userId, keyId, workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'API key not found',
          message: 'The specified API key was not found',
        });
      }

      log.info('API key revoked', {
        workspaceId,
        userId,
        keyId,
        name: result.rows[0].name,
      });

      res.json({
        message: 'API key revoked successfully',
      });
    } catch (error) {
      log.error('API key revocation error', { workspaceId, userId, keyId, error });
      res.status(500).json({
        error: 'Failed to revoke API key',
        message: 'An error occurred while revoking the API key',
      });
    }
  })
);

// Validate token endpoint (for plugin to verify tokens)
router.get(
  '/validate',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({
        valid: false,
        error: 'Invalid or missing token',
      });
    }

    const { userId, workspaceId } = req.user;

    // Check if session still exists
    const sessionKey = `session:${workspaceId}:${userId}`;
    const session = await cache.get(sessionKey);

    if (!session) {
      return res.status(401).json({
        valid: false,
        error: 'Session expired',
      });
    }

    res.json({
      valid: true,
      user: req.user,
    });
  })
);

export default router;