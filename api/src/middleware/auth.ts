import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

// Extended Request interface with user data
export interface AuthRequest extends Request {
  user?: {
    id: string;
    userId: string;
    workspaceId: string;
    username?: string;
    role?: string;
    subscription?: string;
  };
}

// JWT payload interface
interface JWTPayload {
  userId: string;
  workspaceId: string;
  username?: string;
  role?: string;
  subscription?: string;
  iat?: number;
  exp?: number;
}

// Generate JWT token
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
  
  const options = {
    expiresIn: process.env.JWT_EXPIRY || '24h',
    issuer: 'universal-translator-pro',
  } as jwt.SignOptions;
  return jwt.sign(payload, secret, options);
}

// Verify and decode JWT token
export function verifyToken(token: string): JWTPayload | null {
  const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
  try {
    return jwt.verify(token, secret) as JWTPayload;
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

// Authentication middleware
export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please provide a valid access token'
    });
  }

  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(403).json({ 
      error: 'Invalid token',
      message: 'Token is invalid or expired'
    });
  }

  // Attach user info to request
  req.user = {
    id: decoded.userId,
    userId: decoded.userId,
    workspaceId: decoded.workspaceId,
    username: decoded.username,
    role: decoded.role,
    subscription: decoded.subscription,
  };

  next();
}

// Optional authentication (doesn't fail if no token)
export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = {
        id: decoded.userId,
        userId: decoded.userId,
        workspaceId: decoded.workspaceId,
        username: decoded.username,
        role: decoded.role,
        subscription: decoded.subscription,
      };
    }
  }

  next();
}

// API Key authentication for service-to-service communication
export async function authenticateApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      message: 'Please provide a valid API key in x-api-key header'
    });
  }

  try {
    // Check API key in database
    const result = await pool.query(
      `SELECT workspace_id, is_active 
       FROM provider_configs 
       WHERE api_key_encrypted = crypt($1, api_key_encrypted)
       AND is_active = true
       LIMIT 1`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ 
        error: 'Invalid API key',
        message: 'The provided API key is invalid or inactive'
      });
    }

    // Attach workspace info to request
    req.user = {
      id: 'api-user',
      userId: 'api-user',
      workspaceId: result.rows[0].workspace_id,
      role: 'api',
    };

    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'Failed to verify API key'
    });
  }
}

// Role-based access control middleware
export function requireRole(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required'
      });
    }

    if (!req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `Required role: ${roles.join(' or ')}`
      });
    }

    next();
  };
}

// Subscription tier check middleware
export function requireSubscription(tiers: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required'
      });
    }

    try {
      // Check subscription in database
      const result = await pool.query(
        `SELECT subscription_tier, status 
         FROM workspace_subscriptions 
         WHERE workspace_id = $1`,
        [req.user.workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({ 
          error: 'No subscription found',
          message: 'Please subscribe to use this feature'
        });
      }

      const subscription = result.rows[0];
      
      if (subscription.status !== 'active') {
        return res.status(403).json({ 
          error: 'Subscription inactive',
          message: 'Your subscription is not active'
        });
      }

      if (!tiers.includes(subscription.subscription_tier)) {
        return res.status(403).json({ 
          error: 'Upgrade required',
          message: `This feature requires ${tiers.join(' or ')} subscription`
        });
      }

      // Attach subscription info to user
      req.user.subscription = subscription.subscription_tier;
      
      next();
    } catch (error) {
      console.error('Subscription check error:', error);
      res.status(500).json({ 
        error: 'Failed to verify subscription'
      });
    }
  };
}