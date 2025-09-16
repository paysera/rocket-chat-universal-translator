import Redis from 'ioredis';

// Create Redis client with retry strategy
export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => {
    // Exponential backoff with max 2 seconds
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Redis event handlers
redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Redis: Connected to server');
});

redis.on('ready', () => {
  console.log('Redis: Ready to accept commands');
});

redis.on('close', () => {
  console.log('Redis: Connection closed');
});

redis.on('reconnecting', (delay: number) => {
  console.log(`Redis: Reconnecting in ${delay}ms`);
});

// Cache helper functions
export const cache = {
  // Get cached value
  async get(key: string): Promise<any> {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  },

  // Set cached value with TTL
  async set(key: string, value: any, ttlSeconds: number = 3600): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      await redis.setex(key, ttlSeconds, serialized);
      return true;
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  },

  // Delete cached value
  async delete(key: string): Promise<boolean> {
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  },

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  },

  // Increment counter
  async increment(key: string, ttlSeconds?: number): Promise<number> {
    try {
      const value = await redis.incr(key);
      if (ttlSeconds) {
        await redis.expire(key, ttlSeconds);
      }
      return value;
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  },

  // Get multiple keys
  async getMany(keys: string[]): Promise<Map<string, any>> {
    try {
      const values = await redis.mget(...keys);
      const result = new Map<string, any>();
      keys.forEach((key, index) => {
        const value = values[index];
        if (value) {
          result.set(key, JSON.parse(value));
        }
      });
      return result;
    } catch (error) {
      console.error('Cache getMany error:', error);
      return new Map();
    }
  },

  // Clear all cache (use with caution)
  async flush(): Promise<void> {
    try {
      await redis.flushdb();
      console.log('Cache flushed');
    } catch (error) {
      console.error('Cache flush error:', error);
    }
  }
};

// Translation cache key generator
export function getTranslationCacheKey(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider?: string
): string {
  const baseKey = `translation:${sourceLang}:${targetLang}:${Buffer.from(text).toString('base64').slice(0, 50)}`;
  return provider ? `${baseKey}:${provider}` : baseKey;
}

// User preference cache key
export function getUserPreferenceCacheKey(userId: string, workspaceId: string): string {
  return `user:${workspaceId}:${userId}:preferences`;
}

// Graceful shutdown
export async function closeRedis() {
  await redis.quit();
  console.log('Redis connection closed');
}