import { Router, Request, Response } from 'express';
import { Client } from 'pg';
import Redis from 'ioredis';
import axios from 'axios';

const router = Router();

// Simple liveness check
router.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Comprehensive readiness check
router.get('/readyz', async (_req: Request, res: Response) => {
  const checks = {
    database: false,
    redis: false,
    rocketchat: false
  };

  try {
    // Check database
    const pgClient = new Client({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });

    try {
      await pgClient.connect();
      await pgClient.query('SELECT 1');
      checks.database = true;
      await pgClient.end();
    } catch (error) {
      console.error('Health check - Database failed:', error);
    }

    // Check Redis
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: () => null
    });

    try {
      const pong = await redis.ping();
      if (pong === 'PONG') {
        checks.redis = true;
      }
      redis.disconnect();
    } catch (error) {
      console.error('Health check - Redis failed:', error);
    }

    // Check Rocket.Chat
    try {
      const response = await axios.get(`${process.env.ROCKETCHAT_URL}/api/info`, {
        timeout: 3000
      });
      if (response.status === 200) {
        checks.rocketchat = true;
      }
    } catch (error) {
      console.error('Health check - Rocket.Chat failed:', error);
    }

    const allHealthy = Object.values(checks).every(check => check);

    if (allHealthy) {
      res.status(200).json({
        status: 'ready',
        checks,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        checks,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'error',
      checks,
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;