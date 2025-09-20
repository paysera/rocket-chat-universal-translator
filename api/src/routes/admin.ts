import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';
import { adminRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../middleware/errorHandler';
import { pool } from '../config/database';
import { cache, redis } from '../config/redis';
import { log } from '../utils/logger';

const router = Router();

// Apply admin rate limiting to all routes
router.use(adminRateLimiter);

// Require admin role for all routes
router.use(requireRole(['admin', 'owner']));

// Interfaces
interface WorkspaceStats {
  totalUsers: number;
  activeUsers: number;
  totalTranslations: number;
  totalCharacters: number;
  totalCost: number;
  averageResponseTime: number;
  cacheHitRate: number;
  topLanguages: Array<{ language: string; count: number }>;
  topUsers: Array<{ userId: string; username?: string; translations: number; characters: number }>;
}

interface SystemHealth {
  database: {
    status: 'healthy' | 'degraded' | 'down';
    connectionCount: number;
    responseTime: number;
  };
  redis: {
    status: 'healthy' | 'degraded' | 'down';
    memory: { used: string; peak: string };
    connectedClients: number;
  };
  translation: {
    providers: Record<string, { status: string; responseTime: number; errors: number }>;
  };
  api: {
    requestsPerMinute: number;
    averageResponseTime: number;
    errorRate: number;
  };
}

// Get workspace analytics
router.get(
  '/analytics',
  [
    query('period')
      .optional()
      .isIn(['day', 'week', 'month', 'quarter', 'year']).withMessage('Invalid period'),
    query('start')
      .optional()
      .isISO8601().withMessage('Invalid start date'),
    query('end')
      .optional()
      .isISO8601().withMessage('Invalid end date'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId } = req.user!;
    const { period = 'month', start, end } = req.query as any;

    try {
      let startDate: Date;
      let endDate: Date = new Date();

      if (start && end) {
        startDate = new Date(start);
        endDate = new Date(end);
      } else {
        switch (period) {
          case 'day':
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            break;
          case 'week':
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            break;
          case 'month':
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
            break;
          case 'quarter':
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 3);
            break;
          case 'year':
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
          default:
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
        }
      }

      const cacheKey = `admin:analytics:${workspaceId}:${startDate.toISOString()}:${endDate.toISOString()}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        return res.json(cached);
      }

      // Get overall stats
      const statsResult = await pool.query(
        `SELECT
          COUNT(DISTINCT user_id) as total_users,
          COUNT(DISTINCT CASE WHEN created_at >= $2 THEN user_id END) as active_users,
          COUNT(*) as total_translations,
          SUM(characters) as total_characters,
          SUM(cost_amount) as total_cost,
          AVG(response_time_ms) as avg_response_time,
          AVG(CASE WHEN cache_hit THEN 1 ELSE 0 END) as cache_hit_rate
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3`,
        [workspaceId, startDate, endDate]
      );

      // Get language statistics
      const languageResult = await pool.query(
        `SELECT
          COALESCE(NULLIF(ut.channel_id, ''), 'direct') as language,
          COUNT(*) as count
         FROM usage_tracking ut
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY language
         ORDER BY count DESC
         LIMIT 10`,
        [workspaceId, startDate, endDate]
      );

      // Get top users
      const userResult = await pool.query(
        `SELECT
          ut.user_id,
          up.username,
          COUNT(*) as translations,
          SUM(ut.characters) as characters
         FROM usage_tracking ut
         LEFT JOIN user_preferences up ON ut.user_id = up.user_id AND ut.workspace_id = up.workspace_id
         WHERE ut.workspace_id = $1
         AND ut.created_at BETWEEN $2 AND $3
         GROUP BY ut.user_id, up.username
         ORDER BY translations DESC
         LIMIT 10`,
        [workspaceId, startDate, endDate]
      );

      // Get usage trends
      const trendResult = await pool.query(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) as translations,
          SUM(characters) as characters,
          SUM(cost_amount) as cost,
          AVG(response_time_ms) as avg_response_time
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [workspaceId, startDate, endDate]
      );

      const stats = statsResult.rows[0];
      const analytics: WorkspaceStats & { trends: any[] } = {
        totalUsers: parseInt(stats.total_users || '0'),
        activeUsers: parseInt(stats.active_users || '0'),
        totalTranslations: parseInt(stats.total_translations || '0'),
        totalCharacters: parseInt(stats.total_characters || '0'),
        totalCost: parseFloat(stats.total_cost || '0'),
        averageResponseTime: parseFloat(stats.avg_response_time || '0'),
        cacheHitRate: parseFloat(stats.cache_hit_rate || '0'),
        topLanguages: languageResult.rows.map(row => ({
          language: row.language,
          count: parseInt(row.count),
        })),
        topUsers: userResult.rows.map(row => ({
          userId: row.user_id,
          username: row.username,
          translations: parseInt(row.translations),
          characters: parseInt(row.characters),
        })),
        trends: trendResult.rows.map(row => ({
          date: row.date,
          translations: parseInt(row.translations),
          characters: parseInt(row.characters),
          cost: parseFloat(row.cost),
          averageResponseTime: parseFloat(row.avg_response_time),
        })),
      };

      // Cache for 10 minutes
      await cache.set(cacheKey, analytics, 600);

      res.json(analytics);
    } catch (error) {
      log.error('Get analytics error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get analytics',
        message: 'An error occurred while fetching analytics data',
      });
    }
  })
);

// Get system health status
router.get(
  '/health',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const health: SystemHealth = {
        database: {
          status: 'healthy',
          connectionCount: 0,
          responseTime: 0,
        },
        redis: {
          status: 'healthy',
          memory: { used: '0MB', peak: '0MB' },
          connectedClients: 0,
        },
        translation: {
          providers: {},
        },
        api: {
          requestsPerMinute: 0,
          averageResponseTime: 0,
          errorRate: 0,
        },
      };

      // Check database health
      const dbStart = Date.now();
      try {
        const dbResult = await pool.query('SELECT COUNT(*) FROM pg_stat_activity WHERE state = $1', ['active']);
        health.database.responseTime = Date.now() - dbStart;
        health.database.connectionCount = parseInt(dbResult.rows[0].count);
        health.database.status = health.database.responseTime > 1000 ? 'degraded' : 'healthy';
      } catch (error) {
        health.database.status = 'down';
        log.error('Database health check failed', error);
      }

      // Check Redis health
      try {
        const redisInfo = await redis.info('memory');
        const redisClients = await redis.info('clients');

        const memoryMatch = redisInfo.match(/used_memory_human:([^\r\n]+)/);
        const peakMatch = redisInfo.match(/used_memory_peak_human:([^\r\n]+)/);
        const clientsMatch = redisClients.match(/connected_clients:(\d+)/);

        health.redis.memory.used = memoryMatch ? memoryMatch[1] : '0MB';
        health.redis.memory.peak = peakMatch ? peakMatch[1] : '0MB';
        health.redis.connectedClients = clientsMatch ? parseInt(clientsMatch[1]) : 0;

        health.redis.status = 'healthy';
      } catch (error) {
        health.redis.status = 'down';
        log.error('Redis health check failed', error);
      }

      // Check translation providers (placeholder)
      health.translation.providers = {
        openai: { status: 'healthy', responseTime: 150, errors: 0 },
        claude: { status: 'healthy', responseTime: 200, errors: 0 },
        google: { status: 'healthy', responseTime: 100, errors: 1 },
        deepl: { status: 'degraded', responseTime: 500, errors: 5 },
      };

      // Get API metrics from Redis (last 5 minutes)
      try {
        const apiMetrics = await redis.get('metrics:api:last_5min');
        if (apiMetrics) {
          const parsed = JSON.parse(apiMetrics);
          health.api = {
            requestsPerMinute: parsed.rpm || 0,
            averageResponseTime: parsed.avgResponseTime || 0,
            errorRate: parsed.errorRate || 0,
          };
        }
      } catch (error) {
        log.error('API metrics fetch failed', error);
      }

      res.json(health);
    } catch (error) {
      log.error('System health check error', error);
      res.status(500).json({
        error: 'Health check failed',
        message: 'An error occurred while checking system health',
      });
    }
  })
);

// Get all workspace users
router.get(
  '/users',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('search')
      .optional()
      .isLength({ min: 1, max: 100 }).withMessage('Search term too long'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId } = req.user!;
    const { limit = 20, offset = 0, search } = req.query as any;

    try {
      let whereClause = 'WHERE up.workspace_id = $1';
      let queryParams: any[] = [workspaceId];

      if (search) {
        whereClause += ' AND (up.username ILIKE $2 OR up.user_id ILIKE $2)';
        queryParams.push(`%${search}%`);
      }

      const result = await pool.query(
        `SELECT
          up.user_id,
          up.username,
          up.enabled,
          up.source_language,
          up.target_language,
          up.quality_tier,
          up.created_at,
          up.updated_at,
          COALESCE(stats.total_translations, 0) as total_translations,
          COALESCE(stats.total_characters, 0) as total_characters,
          COALESCE(stats.total_cost, 0) as total_cost,
          stats.last_activity
         FROM user_preferences up
         LEFT JOIN (
           SELECT
             user_id,
             COUNT(*) as total_translations,
             SUM(characters) as total_characters,
             SUM(cost_amount) as total_cost,
             MAX(created_at) as last_activity
           FROM usage_tracking
           WHERE workspace_id = $1
           GROUP BY user_id
         ) stats ON up.user_id = stats.user_id
         ${whereClause}
         ORDER BY stats.last_activity DESC NULLS LAST, up.created_at DESC
         LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
        [...queryParams, limit, offset]
      );

      // Get total count for pagination
      const countResult = await pool.query(
        `SELECT COUNT(*) as total
         FROM user_preferences up
         ${whereClause}`,
        queryParams
      );

      res.json({
        users: result.rows.map(row => ({
          userId: row.user_id,
          username: row.username,
          enabled: row.enabled,
          preferences: {
            sourceLanguage: row.source_language,
            targetLanguage: row.target_language,
            qualityTier: row.quality_tier,
          },
          stats: {
            totalTranslations: parseInt(row.total_translations),
            totalCharacters: parseInt(row.total_characters),
            totalCost: parseFloat(row.total_cost),
            lastActivity: row.last_activity,
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        pagination: {
          total: parseInt(countResult.rows[0].total),
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      log.error('Get users error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get users',
        message: 'An error occurred while fetching users',
      });
    }
  })
);

// Update user settings (admin action)
router.put(
  '/users/:userId',
  [
    param('userId').notEmpty().withMessage('User ID is required'),
    body('enabled')
      .optional()
      .isBoolean().withMessage('Enabled must be boolean'),
    body('sourceLanguage')
      .optional()
      .isLength({ min: 2, max: 10 }).withMessage('Invalid source language'),
    body('targetLanguage')
      .optional()
      .isLength({ min: 2, max: 10 }).withMessage('Invalid target language'),
    body('qualityTier')
      .optional()
      .isIn(['fast', 'balanced', 'quality']).withMessage('Invalid quality tier'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { userId: targetUserId } = req.params;
    const { workspaceId, userId: adminUserId } = req.user!;
    const updates = req.body;

    try {
      // Check if user exists
      const userCheck = await pool.query(
        'SELECT user_id FROM user_preferences WHERE user_id = $1 AND workspace_id = $2',
        [targetUserId, workspaceId]
      );

      if (userCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'The specified user was not found in this workspace',
        });
      }

      // Build update query
      const updateFields = [];
      const values = [targetUserId, workspaceId];
      let paramCount = 2;

      if (updates.enabled !== undefined) {
        paramCount++;
        updateFields.push(`enabled = $${paramCount}`);
        values.push(updates.enabled);
      }

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

      if (updateFields.length === 0) {
        return res.status(400).json({
          error: 'No valid fields to update',
        });
      }

      const result = await pool.query(
        `UPDATE user_preferences
         SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND workspace_id = $2
         RETURNING *`,
        values
      );

      // Clear user cache
      const cacheKey = `user:${workspaceId}:${targetUserId}:preferences`;
      await cache.delete(cacheKey);

      log.info('User preferences updated by admin', {
        workspaceId,
        adminUserId,
        targetUserId,
        updates,
      });

      res.json({
        message: 'User preferences updated successfully',
        user: {
          userId: result.rows[0].user_id,
          username: result.rows[0].username,
          enabled: result.rows[0].enabled,
          preferences: {
            sourceLanguage: result.rows[0].source_language,
            targetLanguage: result.rows[0].target_language,
            qualityTier: result.rows[0].quality_tier,
          },
          updatedAt: result.rows[0].updated_at,
        },
      });
    } catch (error) {
      log.error('Update user error', { workspaceId, adminUserId, targetUserId, error });
      res.status(500).json({
        error: 'Failed to update user',
        message: 'An error occurred while updating user preferences',
      });
    }
  })
);

// Get system logs
router.get(
  '/logs',
  [
    query('level')
      .optional()
      .isIn(['error', 'warn', 'info', 'debug']).withMessage('Invalid log level'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
    query('since')
      .optional()
      .isISO8601().withMessage('Invalid since date'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId } = req.user!;
    const { level, limit = 100, since } = req.query as any;

    try {
      // In a real implementation, you'd query your logging system
      // This is a placeholder that returns recent activities
      let whereClause = 'WHERE workspace_id = $1';
      let queryParams: any[] = [workspaceId];

      if (since) {
        whereClause += ' AND created_at >= $2';
        queryParams.push(new Date(since));
      }

      const result = await pool.query(
        `SELECT
          'translation' as type,
          user_id,
          CASE
            WHEN cache_hit THEN 'info'
            WHEN response_time_ms > 5000 THEN 'warn'
            ELSE 'info'
          END as level,
          'Translation request' as message,
          json_build_object(
            'characters', characters,
            'provider', provider,
            'responseTime', response_time_ms,
            'cacheHit', cache_hit,
            'cost', cost_amount
          ) as metadata,
          created_at
         FROM usage_tracking
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${queryParams.length + 1}`,
        [...queryParams, limit]
      );

      const logs = result.rows.filter(row => !level || row.level === level);

      res.json({
        logs: logs.map(row => ({
          timestamp: row.created_at,
          level: row.level,
          type: row.type,
          message: row.message,
          userId: row.user_id,
          metadata: row.metadata,
        })),
        total: logs.length,
      });
    } catch (error) {
      log.error('Get logs error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get logs',
        message: 'An error occurred while fetching logs',
      });
    }
  })
);

// Clear cache
router.post(
  '/cache/clear',
  [
    body('type')
      .optional()
      .isIn(['all', 'translation', 'user', 'analytics']).withMessage('Invalid cache type'),
    body('key')
      .optional()
      .isLength({ min: 1 }).withMessage('Cache key cannot be empty'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId, userId } = req.user!;
    const { type = 'all', key } = req.body;

    try {
      let deletedKeys = 0;

      if (key) {
        // Clear specific key
        await cache.delete(key);
        deletedKeys = 1;
      } else {
        // Clear by type
        const patterns = {
          all: [`user:${workspaceId}:*`, `translation:*`, `admin:*:${workspaceId}:*`],
          translation: ['translation:*'],
          user: [`user:${workspaceId}:*`],
          analytics: [`admin:analytics:${workspaceId}:*`],
        };

        const keysToDelete = patterns[type as keyof typeof patterns] || [];

        for (const pattern of keysToDelete) {
          // In production, use Redis SCAN to find and delete keys matching pattern
          // This is a simplified implementation
          const keys = await redis.keys(pattern);
          if (keys.length > 0) {
            await redis.del(...keys);
            deletedKeys += keys.length;
          }
        }
      }

      log.info('Cache cleared by admin', {
        workspaceId,
        userId,
        type,
        key,
        deletedKeys,
      });

      res.json({
        message: 'Cache cleared successfully',
        deletedKeys,
        type,
        key,
      });
    } catch (error) {
      log.error('Clear cache error', { workspaceId, userId, error });
      res.status(500).json({
        error: 'Failed to clear cache',
        message: 'An error occurred while clearing cache',
      });
    }
  })
);

// Export workspace data
router.get(
  '/export',
  [
    query('format')
      .optional()
      .isIn(['json', 'csv']).withMessage('Invalid export format'),
    query('include')
      .optional()
      .isArray().withMessage('Include must be an array'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { workspaceId, userId } = req.user!;
    const { format = 'json', include = ['users', 'usage', 'preferences'] } = req.query as any;

    try {
      const exportData: any = {
        workspace: workspaceId,
        exportedAt: new Date().toISOString(),
        exportedBy: userId,
      };

      if (include.includes('users')) {
        const usersResult = await pool.query(
          'SELECT * FROM user_preferences WHERE workspace_id = $1',
          [workspaceId]
        );
        exportData.users = usersResult.rows;
      }

      if (include.includes('usage')) {
        const usageResult = await pool.query(
          'SELECT * FROM usage_tracking WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 10000',
          [workspaceId]
        );
        exportData.usage = usageResult.rows;
      }

      if (include.includes('preferences')) {
        const configResult = await pool.query(
          'SELECT * FROM channel_configs WHERE workspace_id = $1',
          [workspaceId]
        );
        exportData.channelConfigs = configResult.rows;
      }

      log.info('Data exported by admin', {
        workspaceId,
        userId,
        format,
        include,
      });

      if (format === 'csv') {
        // For CSV, we'd convert the data to CSV format
        // This is a simplified JSON response for now
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="workspace-${workspaceId}-export.csv"`);
        // In a real implementation, convert to CSV here
        res.send('CSV export not implemented yet');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="workspace-${workspaceId}-export.json"`);
        res.json(exportData);
      }
    } catch (error) {
      log.error('Export data error', { workspaceId, userId, error });
      res.status(500).json({
        error: 'Failed to export data',
        message: 'An error occurred while exporting workspace data',
      });
    }
  })
);

export default router;