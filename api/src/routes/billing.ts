import { Router, Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { pool } from '../config/database';
import { cache } from '../config/redis';
import { log } from '../utils/logger';

const router = Router();

// Interfaces
interface SubscriptionTier {
  tier: 'trial' | 'byoa' | 'managed';
  name: string;
  features: string[];
  limits: {
    charactersPerMonth: number;
    requestsPerMinute: number;
    teamSize: number;
  };
  pricing?: {
    monthly: number;
    annual: number;
  };
}

interface UsageData {
  workspaceId: string;
  period: {
    start: Date;
    end: Date;
  };
  usage: {
    totalCharacters: number;
    totalRequests: number;
    totalCost: number;
    cacheHitRate: number;
  };
  breakdown: {
    byProvider: Record<string, { characters: number; cost: number; requests: number }>;
    byUser: Record<string, { characters: number; cost: number; requests: number }>;
    byLanguage: Record<string, { characters: number; requests: number }>;
  };
}

// Get subscription plans
router.get(
  '/plans',
  asyncHandler(async (req: Request, res: Response) => {
    const plans: SubscriptionTier[] = [
      {
        tier: 'trial',
        name: 'Trial',
        features: [
          'Up to 10,000 characters/month',
          'Basic translation quality',
          'Community support',
          'Up to 5 team members',
        ],
        limits: {
          charactersPerMonth: 10000,
          requestsPerMinute: 10,
          teamSize: 5,
        },
      },
      {
        tier: 'byoa',
        name: 'Bring Your Own API (BYOA)',
        features: [
          'Unlimited characters with your API keys',
          'Premium translation quality',
          'Priority support',
          'Advanced analytics',
          'Custom integrations',
          'Up to 50 team members',
        ],
        limits: {
          charactersPerMonth: -1, // Unlimited
          requestsPerMinute: 100,
          teamSize: 50,
        },
        pricing: {
          monthly: 49,
          annual: 499,
        },
      },
      {
        tier: 'managed',
        name: 'Managed Service',
        features: [
          'Fully managed translation service',
          'Enterprise-grade security',
          'SLA guarantees',
          'Dedicated support',
          'Custom models',
          'Unlimited team members',
          'Advanced reporting',
        ],
        limits: {
          charactersPerMonth: -1, // Unlimited
          requestsPerMinute: 500,
          teamSize: -1, // Unlimited
        },
        pricing: {
          monthly: 199,
          annual: 1999,
        },
      },
    ];

    res.json({ plans });
  })
);

// Get current subscription
router.get(
  '/subscription',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.user!;

    try {
      const result = await pool.query(
        `SELECT
          ws.*,
          COALESCE(
            (SELECT SUM(cost_amount)
             FROM usage_tracking
             WHERE workspace_id = ws.workspace_id
             AND created_at >= date_trunc('month', CURRENT_DATE)
            ), 0
          ) as current_month_cost,
          COALESCE(
            (SELECT SUM(characters)
             FROM usage_tracking
             WHERE workspace_id = ws.workspace_id
             AND created_at >= date_trunc('month', CURRENT_DATE)
            ), 0
          ) as current_month_characters
         FROM workspace_subscriptions ws
         WHERE ws.workspace_id = $1`,
        [workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Subscription not found',
          message: 'No subscription found for this workspace',
        });
      }

      const subscription = result.rows[0];

      res.json({
        workspaceId: subscription.workspace_id,
        tier: subscription.subscription_tier,
        status: subscription.status,
        currentPeriod: {
          start: subscription.current_period_start,
          end: subscription.current_period_end,
        },
        usage: {
          currentMonthCost: parseFloat(subscription.current_month_cost),
          currentMonthCharacters: parseInt(subscription.current_month_characters),
          limit: subscription.usage_limit ? parseFloat(subscription.usage_limit) : null,
        },
        billing: {
          nextBillingDate: subscription.next_billing_date,
          lastPayment: subscription.last_payment_date,
          paymentMethod: subscription.payment_method,
        },
        createdAt: subscription.created_at,
        updatedAt: subscription.updated_at,
      });
    } catch (error) {
      log.error('Get subscription error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get subscription',
        message: 'An error occurred while fetching subscription details',
      });
    }
  })
);

// Get usage data
router.get(
  '/usage',
  authenticateToken,
  [
    query('period')
      .optional()
      .isIn(['day', 'week', 'month', 'year']).withMessage('Invalid period'),
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
        // Calculate period
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
          case 'year':
            startDate = new Date();
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
          default:
            startDate = new Date();
            startDate.setMonth(startDate.getMonth() - 1);
        }
      }

      // Cache key for usage data
      const cacheKey = `usage:${workspaceId}:${startDate.toISOString()}:${endDate.toISOString()}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        return res.json(cached);
      }

      // Get overall usage stats
      const usageResult = await pool.query(
        `SELECT
          COUNT(*) as total_requests,
          SUM(characters) as total_characters,
          SUM(cost_amount) as total_cost,
          AVG(CASE WHEN cache_hit THEN 1 ELSE 0 END) as cache_hit_rate
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3`,
        [workspaceId, startDate, endDate]
      );

      // Get breakdown by provider
      const providerResult = await pool.query(
        `SELECT
          provider,
          COUNT(*) as requests,
          SUM(characters) as characters,
          SUM(cost_amount) as cost
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY provider
         ORDER BY cost DESC`,
        [workspaceId, startDate, endDate]
      );

      // Get breakdown by user
      const userResult = await pool.query(
        `SELECT
          user_id,
          COUNT(*) as requests,
          SUM(characters) as characters,
          SUM(cost_amount) as cost
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY user_id
         ORDER BY cost DESC
         LIMIT 20`,
        [workspaceId, startDate, endDate]
      );

      // Get daily usage trend
      const trendResult = await pool.query(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) as requests,
          SUM(characters) as characters,
          SUM(cost_amount) as cost
         FROM usage_tracking
         WHERE workspace_id = $1
         AND created_at BETWEEN $2 AND $3
         GROUP BY DATE(created_at)
         ORDER BY date`,
        [workspaceId, startDate, endDate]
      );

      const usage = usageResult.rows[0];
      const usageData: UsageData = {
        workspaceId,
        period: {
          start: startDate,
          end: endDate,
        },
        usage: {
          totalCharacters: parseInt(usage.total_characters || '0'),
          totalRequests: parseInt(usage.total_requests || '0'),
          totalCost: parseFloat(usage.total_cost || '0'),
          cacheHitRate: parseFloat(usage.cache_hit_rate || '0'),
        },
        breakdown: {
          byProvider: providerResult.rows.reduce((acc, row) => {
            acc[row.provider] = {
              characters: parseInt(row.characters),
              cost: parseFloat(row.cost),
              requests: parseInt(row.requests),
            };
            return acc;
          }, {}),
          byUser: userResult.rows.reduce((acc, row) => {
            acc[row.user_id] = {
              characters: parseInt(row.characters),
              cost: parseFloat(row.cost),
              requests: parseInt(row.requests),
            };
            return acc;
          }, {}),
          byLanguage: {}, // TODO: Implement language tracking
        },
      };

      // Add trend data
      (usageData as any).trend = trendResult.rows.map(row => ({
        date: row.date,
        requests: parseInt(row.requests),
        characters: parseInt(row.characters),
        cost: parseFloat(row.cost),
      }));

      // Cache for 5 minutes
      await cache.set(cacheKey, usageData, 300);

      res.json(usageData);
    } catch (error) {
      log.error('Get usage error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get usage data',
        message: 'An error occurred while fetching usage information',
      });
    }
  })
);

// Update subscription
router.put(
  '/subscription',
  authenticateToken,
  requireRole(['admin', 'owner']),
  [
    body('tier')
      .isIn(['trial', 'byoa', 'managed']).withMessage('Invalid subscription tier'),
    body('paymentMethod')
      .optional()
      .isLength({ min: 1 }).withMessage('Payment method cannot be empty'),
    body('billingCycle')
      .optional()
      .isIn(['monthly', 'annual']).withMessage('Invalid billing cycle'),
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
    const { tier, paymentMethod, billingCycle = 'monthly' } = req.body;

    try {
      // Calculate new period dates
      const now = new Date();
      const periodEnd = new Date(now);

      if (billingCycle === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      // Update subscription
      const result = await pool.query(
        `UPDATE workspace_subscriptions
         SET
           subscription_tier = $1,
           payment_method = COALESCE($2, payment_method),
           current_period_start = $3,
           current_period_end = $4,
           next_billing_date = $4,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = $5
         WHERE workspace_id = $6
         RETURNING *`,
        [tier, paymentMethod, now, periodEnd, userId, workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Subscription not found',
          message: 'No subscription found for this workspace',
        });
      }

      // Clear usage cache
      const cachePattern = `usage:${workspaceId}:*`;
      // Note: In production, you'd want to use Redis SCAN to delete cache keys

      log.info('Subscription updated', {
        workspaceId,
        userId,
        oldTier: result.rows[0].subscription_tier,
        newTier: tier,
        billingCycle,
      });

      res.json({
        message: 'Subscription updated successfully',
        subscription: {
          tier,
          status: result.rows[0].status,
          currentPeriod: {
            start: now,
            end: periodEnd,
          },
          nextBillingDate: periodEnd,
        },
      });
    } catch (error) {
      log.error('Update subscription error', { workspaceId, userId, error });
      res.status(500).json({
        error: 'Failed to update subscription',
        message: 'An error occurred while updating subscription',
      });
    }
  })
);

// Get billing history
router.get(
  '/history',
  authenticateToken,
  requireRole(['admin', 'owner']),
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 }).withMessage('Offset must be non-negative'),
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
    const { limit = 20, offset = 0 } = req.query as any;

    try {
      // Get billing history (this would integrate with actual payment processor)
      const result = await pool.query(
        `SELECT
          'subscription' as type,
          subscription_tier as description,
          0 as amount, -- Placeholder
          'USD' as currency,
          created_at as date,
          'completed' as status
         FROM workspace_subscriptions
         WHERE workspace_id = $1
         UNION ALL
         SELECT
          'usage' as type,
          'Translation usage' as description,
          SUM(cost_amount) as amount,
          'USD' as currency,
          date_trunc('month', created_at) as date,
          'completed' as status
         FROM usage_tracking
         WHERE workspace_id = $1
         GROUP BY date_trunc('month', created_at)
         ORDER BY date DESC
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      );

      // Get total count for pagination
      const countResult = await pool.query(
        `SELECT COUNT(*) as total
         FROM (
           SELECT created_at FROM workspace_subscriptions WHERE workspace_id = $1
           UNION ALL
           SELECT date_trunc('month', created_at) FROM usage_tracking WHERE workspace_id = $1 GROUP BY date_trunc('month', created_at)
         ) as combined`,
        [workspaceId]
      );

      res.json({
        history: result.rows.map(row => ({
          type: row.type,
          description: row.description,
          amount: parseFloat(row.amount || '0'),
          currency: row.currency,
          date: row.date,
          status: row.status,
        })),
        pagination: {
          total: parseInt(countResult.rows[0].total),
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      log.error('Get billing history error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get billing history',
        message: 'An error occurred while fetching billing history',
      });
    }
  })
);

// Get current usage limits
router.get(
  '/limits',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.user!;

    try {
      const result = await pool.query(
        `SELECT
          ws.subscription_tier,
          ws.usage_limit,
          COALESCE(
            (SELECT SUM(characters)
             FROM usage_tracking
             WHERE workspace_id = ws.workspace_id
             AND created_at >= date_trunc('month', CURRENT_DATE)
            ), 0
          ) as current_usage,
          COALESCE(
            (SELECT COUNT(DISTINCT user_id)
             FROM user_preferences
             WHERE workspace_id = ws.workspace_id
             AND enabled = true
            ), 0
          ) as active_users
         FROM workspace_subscriptions ws
         WHERE ws.workspace_id = $1`,
        [workspaceId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      const data = result.rows[0];
      const tier = data.subscription_tier;

      // Define limits based on tier
      let limits = {
        charactersPerMonth: 10000,
        requestsPerMinute: 10,
        teamSize: 5,
      };

      switch (tier) {
        case 'byoa':
          limits = {
            charactersPerMonth: -1, // Unlimited
            requestsPerMinute: 100,
            teamSize: 50,
          };
          break;
        case 'managed':
          limits = {
            charactersPerMonth: -1, // Unlimited
            requestsPerMinute: 500,
            teamSize: -1, // Unlimited
          };
          break;
      }

      res.json({
        tier,
        limits,
        usage: {
          charactersThisMonth: parseInt(data.current_usage),
          activeUsers: parseInt(data.active_users),
        },
        quotaUsed: {
          characters: limits.charactersPerMonth > 0
            ? (parseInt(data.current_usage) / limits.charactersPerMonth) * 100
            : 0,
          users: limits.teamSize > 0
            ? (parseInt(data.active_users) / limits.teamSize) * 100
            : 0,
        },
      });
    } catch (error) {
      log.error('Get limits error', { workspaceId, error });
      res.status(500).json({
        error: 'Failed to get usage limits',
        message: 'An error occurred while fetching usage limits',
      });
    }
  })
);

export default router;