import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response } from 'express';
import { redis } from '../config/redis';
import { AuthRequest } from './auth';

// Custom key generator for rate limiting
function keyGenerator(req: Request): string {
  const authReq = req as AuthRequest;
  
  // Use user ID if authenticated
  if (authReq.user?.userId) {
    return `user:${authReq.user.workspaceId}:${authReq.user.userId}`;
  }
  
  // Use API key if present
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey) {
    return `api:${apiKey.substring(0, 16)}`;
  }
  
  // Fall back to IP address
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

// Skip rate limiting for certain conditions
function skip(req: Request): boolean {
  // Skip for health checks
  if (req.path === '/health' || req.path === '/api/v1/health') {
    return true;
  }
  
  // Skip for internal requests (if using internal header)
  if (req.headers['x-internal-request'] === process.env.INTERNAL_SECRET) {
    return true;
  }
  
  return false;
}

// General API rate limiter
export const generalRateLimiter = rateLimit({
  store: new RedisStore({
    // @ts-ignore - RedisStore types are incompatible with current redis client
    client: redis,
    prefix: 'rate_limit:general:',
  } as any),
  windowMs: 60 * 1000, // 1 minute window
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.',
    retryAfter: 60,
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator,
  skip,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests from this user/IP, please try again later',
      retryAfter: 60,
    });
  },
});

// Translation-specific rate limiter (more restrictive)
export const translationRateLimiter = rateLimit({
  store: new RedisStore({
    // @ts-ignore - RedisStore types are incompatible with current redis client
    client: redis,
    prefix: 'rate_limit:translation:',
  } as any),
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 translations per minute per user
  message: {
    error: 'Translation rate limit exceeded',
    message: 'You have exceeded the translation rate limit. Please try again later.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Translation rate limit exceeded',
      message: 'Too many translation requests, please try again in a minute',
      retryAfter: 60,
    });
  },
});

// Strict rate limiter for authentication endpoints
export const authRateLimiter = rateLimit({
  store: new RedisStore({
    // @ts-ignore - RedisStore types are incompatible with current redis client
    client: redis,
    prefix: 'rate_limit:auth:',
  } as any),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: {
    error: 'Authentication rate limit exceeded',
    message: 'Too many authentication attempts. Please try again later.',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use IP for auth endpoints
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  skipSuccessfulRequests: true, // Don't count successful auth
});

// Admin endpoints rate limiter
export const adminRateLimiter = rateLimit({
  store: new RedisStore({
    // @ts-ignore - RedisStore types are incompatible with current redis client
    client: redis,
    prefix: 'rate_limit:admin:',
  } as any),
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute for admin operations
  message: {
    error: 'Admin rate limit exceeded',
    message: 'Too many admin requests. Please slow down.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
});

// Dynamic rate limiter based on subscription tier
export function dynamicRateLimiter(req: AuthRequest, res: Response, next: any) {
  // Skip if no user context
  if (!req.user) {
    return generalRateLimiter(req, res, next);
  }
  
  // Get rate limit based on subscription tier
  let maxRequests = 100; // Default
  
  switch (req.user.subscription) {
    case 'trial':
      maxRequests = 50;
      break;
    case 'byoa':
      maxRequests = 200;
      break;
    case 'managed':
      maxRequests = 500;
      break;
  }
  
  // Create dynamic rate limiter
  const limiter = rateLimit({
    store: new RedisStore({
      // @ts-ignore - RedisStore types are incompatible with current redis client
      client: redis,
      prefix: `rate_limit:dynamic:${req.user.subscription}:`,
    } as any),
    windowMs: 60 * 1000,
    max: maxRequests,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  return limiter(req, res, next as any);
}

// Distributed rate limiter for cluster deployments
export class DistributedRateLimiter {
  private prefix: string;
  private windowMs: number;
  private maxRequests: number;
  
  constructor(options: {
    prefix: string;
    windowMs: number;
    maxRequests: number;
  }) {
    this.prefix = options.prefix;
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }
  
  async checkLimit(key: string): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const redisKey = `${this.prefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Use Redis sorted set for sliding window
    const pipeline = redis.pipeline();
    
    // Remove old entries
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
    
    // Add current request
    pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
    
    // Count requests in window
    pipeline.zcount(redisKey, windowStart, '+inf');
    
    // Set expiry
    pipeline.expire(redisKey, Math.ceil(this.windowMs / 1000));
    
    const results = await pipeline.exec();
    
    if (!results) {
      throw new Error('Redis pipeline failed');
    }
    
    const count = results[2][1] as number;
    const allowed = count <= this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - count);
    const resetAt = new Date(now + this.windowMs);
    
    return { allowed, remaining, resetAt };
  }
  
  middleware() {
    return async (req: Request, res: Response, next: Function) => {
      const key = keyGenerator(req);
      
      try {
        const { allowed, remaining, resetAt } = await this.checkLimit(key);
        
        // Set rate limit headers
        res.setHeader('RateLimit-Limit', this.maxRequests);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', resetAt.toISOString());
        
        if (!allowed) {
          res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Limit: ${this.maxRequests} per ${this.windowMs / 1000} seconds`,
            remaining,
            resetAt,
          });
        } else {
          next();
        }
      } catch (error) {
        console.error('Rate limiter error:', error);
        // Allow request on error (fail open)
        next();
      }
    };
  }
}