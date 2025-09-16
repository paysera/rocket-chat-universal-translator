import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';
import { pool } from '../config/database';
import { cache } from '../config/redis';
import { log } from '../utils/logger';

const router = Router();

// User preferences interface
interface UserPreferences {
  id?: number;
  userId: string;
  username?: string;
  workspaceId: string;
  sourceLanguage: string;
  targetLanguage: string;
  qualityTier: 'fast' | 'balanced' | 'quality';
  autoTranslate: boolean;
  showOriginalHover: boolean;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// Channel configuration interface
interface ChannelConfig {
  id?: number;
  channelId: string;
  channelName?: string;
  workspaceId: string;
  translationEnabled: boolean;
  allowedUsers?: string[];
  blockedLanguages?: string[];
  maxCostPerMessage?: number;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Get user preferences
router.get(
  '/preferences',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, workspaceId } = req.user!;
    
    // Try cache first
    const cacheKey = `user:${workspaceId}:${userId}:preferences`;
    const cached = await cache.get(cacheKey);
    
    if (cached) {
      log.cache('hit', cacheKey);
      return res.json(cached);
    }
    
    // Query database
    const result = await pool.query(
      `SELECT * FROM user_preferences 
       WHERE user_id = $1 AND workspace_id = $2`,
      [userId, workspaceId]
    );
    
    if (result.rows.length === 0) {
      // Return default preferences if none exist
      const defaultPrefs: UserPreferences = {
        userId,
        workspaceId,
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        qualityTier: 'balanced',
        autoTranslate: true,
        showOriginalHover: true,
        enabled: true,
      };
      
      return res.json(defaultPrefs);
    }
    
    const preferences = mapDbToPreferences(result.rows[0]);
    
    // Cache for 5 minutes
    await cache.set(cacheKey, preferences, 300);
    
    res.json(preferences);
  })
);

// Update user preferences
router.put(
  '/preferences',
  authenticateToken,
  [
    body('sourceLanguage')
      .optional()
      .isLength({ min: 2, max: 10 }).withMessage('Invalid language code'),
    body('targetLanguage')
      .optional()
      .isLength({ min: 2, max: 10 }).withMessage('Invalid language code'),
    body('qualityTier')
      .optional()
      .isIn(['fast', 'balanced', 'quality']).withMessage('Invalid quality tier'),
    body('autoTranslate')
      .optional()
      .isBoolean().withMessage('Must be boolean'),
    body('showOriginalHover')
      .optional()
      .isBoolean().withMessage('Must be boolean'),
    body('enabled')
      .optional()
      .isBoolean().withMessage('Must be boolean'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    
    const { userId, workspaceId, username } = req.user!;
    const updates = req.body;
    
    // Build update query dynamically
    const updateFields = [];
    const values = [userId, workspaceId];
    let paramCount = 2;
    
    if (updates.sourceLanguage !== undefined) {
      paramCount++;
      updateFields.push(`source_language = $${paramCount}`);
      values.push(updates.sourceLanguage);
    }
    
    if (updates.targetLanguage !== undefined) {
      paramCount++;
      updateFields.push(`target_language = $${paramCount}`);
      values.push(updates.targetLanguage);
    }
    
    if (updates.qualityTier !== undefined) {
      paramCount++;
      updateFields.push(`quality_tier = $${paramCount}`);
      values.push(updates.qualityTier);
    }
    
    if (updates.autoTranslate !== undefined) {
      paramCount++;
      updateFields.push(`auto_translate = $${paramCount}`);
      values.push(updates.autoTranslate);
    }
    
    if (updates.showOriginalHover !== undefined) {
      paramCount++;
      updateFields.push(`show_original_hover = $${paramCount}`);
      values.push(updates.showOriginalHover);
    }
    
    if (updates.enabled !== undefined) {
      paramCount++;
      updateFields.push(`enabled = $${paramCount}`);
      values.push(updates.enabled);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'No valid fields to update',
      });
    }
    
    // Update or insert preferences
    const query = `
      INSERT INTO user_preferences (user_id, workspace_id, username, ${updateFields.map(f => f.split(' = ')[0]).join(', ')})
      VALUES ($1, $2, $3, ${updateFields.map((_, i) => `$${i + 4}`).join(', ')})
      ON CONFLICT (user_id, workspace_id) 
      DO UPDATE SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    values.splice(2, 0, username || 'unknown'); // Insert username at position 3
    
    const result = await pool.query(query, values);
    const preferences = mapDbToPreferences(result.rows[0]);
    
    // Invalidate cache
    const cacheKey = `user:${workspaceId}:${userId}:preferences`;
    await cache.delete(cacheKey);
    
    // Log preference update
    log.info('User preferences updated', {
      userId,
      workspaceId,
      updates,
    });
    
    res.json(preferences);
  })
);

// Get channel configuration
router.get(
  '/channels/:channelId/config',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { channelId } = req.params;
    const { workspaceId } = req.user!;
    
    const result = await pool.query(
      `SELECT * FROM channel_configs 
       WHERE channel_id = $1 AND workspace_id = $2`,
      [channelId, workspaceId]
    );
    
    if (result.rows.length === 0) {
      // Return default config if none exists
      const defaultConfig: ChannelConfig = {
        channelId,
        workspaceId,
        translationEnabled: false,
        allowedUsers: [],
        blockedLanguages: [],
      };
      
      return res.json(defaultConfig);
    }
    
    const config = mapDbToChannelConfig(result.rows[0]);
    res.json(config);
  })
);

// Update channel configuration (admin only)
router.put(
  '/channels/:channelId/config',
  authenticateToken,
  [
    body('translationEnabled')
      .optional()
      .isBoolean().withMessage('Must be boolean'),
    body('allowedUsers')
      .optional()
      .isArray().withMessage('Must be array'),
    body('blockedLanguages')
      .optional()
      .isArray().withMessage('Must be array'),
    body('maxCostPerMessage')
      .optional()
      .isFloat({ min: 0 }).withMessage('Must be positive number'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    
    const { channelId } = req.params;
    const { userId, workspaceId } = req.user!;
    const updates = req.body;
    
    // TODO: Check if user is admin/owner of channel
    
    // Build update query
    const updateFields = [];
    const values = [channelId, workspaceId];
    let paramCount = 2;
    
    if (updates.translationEnabled !== undefined) {
      paramCount++;
      updateFields.push(`translation_enabled = $${paramCount}`);
      values.push(updates.translationEnabled);
    }
    
    if (updates.allowedUsers !== undefined) {
      paramCount++;
      updateFields.push(`allowed_users = $${paramCount}`);
      values.push(updates.allowedUsers);
    }
    
    if (updates.blockedLanguages !== undefined) {
      paramCount++;
      updateFields.push(`blocked_languages = $${paramCount}`);
      values.push(updates.blockedLanguages);
    }
    
    if (updates.maxCostPerMessage !== undefined) {
      paramCount++;
      updateFields.push(`max_cost_per_message = $${paramCount}`);
      values.push(updates.maxCostPerMessage);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'No valid fields to update',
      });
    }
    
    // Update or insert config
    const query = `
      INSERT INTO channel_configs (channel_id, workspace_id, created_by, ${updateFields.map(f => f.split(' = ')[0]).join(', ')})
      VALUES ($1, $2, $3, ${updateFields.map((_, i) => `$${i + 4}`).join(', ')})
      ON CONFLICT (channel_id, workspace_id) 
      DO UPDATE SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    values.splice(2, 0, userId); // Insert userId as created_by
    
    const result = await pool.query(query, values);
    const config = mapDbToChannelConfig(result.rows[0]);
    
    log.info('Channel config updated', {
      channelId,
      workspaceId,
      userId,
      updates,
    });
    
    res.json(config);
  })
);

// Get all user language preferences in a workspace (admin only)
router.get(
  '/workspace/languages',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.user!;
    
    // TODO: Check if user is admin
    
    const result = await pool.query(
      `SELECT user_id, username, source_language, target_language, enabled 
       FROM user_preferences 
       WHERE workspace_id = $1 
       ORDER BY username`,
      [workspaceId]
    );
    
    const stats = await pool.query(
      `SELECT 
        COUNT(DISTINCT user_id) as total_users,
        COUNT(DISTINCT target_language) as unique_languages,
        array_agg(DISTINCT target_language) as languages_used
       FROM user_preferences 
       WHERE workspace_id = $1 AND enabled = true`,
      [workspaceId]
    );
    
    res.json({
      users: result.rows,
      statistics: {
        totalUsers: parseInt(stats.rows[0].total_users),
        uniqueLanguages: parseInt(stats.rows[0].unique_languages),
        languagesUsed: stats.rows[0].languages_used || [],
      },
    });
  })
);

// Delete user preferences
router.delete(
  '/preferences',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { userId, workspaceId } = req.user!;
    
    await pool.query(
      'DELETE FROM user_preferences WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId]
    );
    
    // Invalidate cache
    const cacheKey = `user:${workspaceId}:${userId}:preferences`;
    await cache.delete(cacheKey);
    
    log.info('User preferences deleted', { userId, workspaceId });
    
    res.json({ message: 'Preferences deleted successfully' });
  })
);

// Helper functions to map database rows to interfaces
function mapDbToPreferences(row: any): UserPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    workspaceId: row.workspace_id,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    qualityTier: row.quality_tier,
    autoTranslate: row.auto_translate,
    showOriginalHover: row.show_original_hover,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDbToChannelConfig(row: any): ChannelConfig {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    workspaceId: row.workspace_id,
    translationEnabled: row.translation_enabled,
    allowedUsers: row.allowed_users,
    blockedLanguages: row.blocked_languages,
    maxCostPerMessage: row.max_cost_per_message ? parseFloat(row.max_cost_per_message) : undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;