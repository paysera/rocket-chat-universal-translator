import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
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
  if (req.path === '/health' || req.path === '/api/v1/health' || req.path === '/api/v1/healthz') {
    return true;
  }

  // Skip for internal requests (if using internal header)
  if (req.headers['x-internal-request'] === process.env.INTERNAL_SECRET) {
    return true;
  }

  return false;
}

// General API rate limiter (using memory store for now)
export const generalRateLimiter = rateLimit({
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
    windowMs: 60 * 1000,
    max: maxRequests,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
  });

  return limiter(req, res, next as any);
}