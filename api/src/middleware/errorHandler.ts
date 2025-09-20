import { Request, Response, NextFunction } from 'express';
import { ValidationError } from 'express-validator';
import { sentryService } from '../services/sentryService';

// Custom error classes
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: any;

  constructor(message: string, statusCode: number, isOperational: boolean = true, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationAppError extends AppError {
  constructor(message: string, errors: ValidationError[]) {
    super(message, 400, true, errors);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, true);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429, true, { retryAfter });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: any) {
    super(`External service error: ${service}`, 503, true, originalError);
  }
}

// Async error wrapper for route handlers
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Global error handler middleware
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Set default error values
  let statusCode = 500;
  let message = 'Internal server error';
  let details = undefined;
  let stack = undefined;
  let isOperational = false;
  let severity: 'error' | 'warning' | 'info' | 'fatal' = 'error';

  // Handle known operational errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
    isOperational = err.isOperational;

    // Set severity based on status code
    if (statusCode >= 500) {
      severity = 'error';
    } else if (statusCode >= 400) {
      severity = 'warning';
    } else {
      severity = 'info';
    }

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      stack = err.stack;
    }
  }

  // Handle Postgres errors
  else if (err.name === 'QueryFailedError' || err.constructor.name === 'QueryFailedError') {
    statusCode = 400;
    message = 'Database query failed';
    severity = 'error';

    // Handle specific Postgres error codes
    const pgError = err as any;
    if (pgError.code === '23505') {
      statusCode = 409;
      message = 'Duplicate entry';
      severity = 'warning';
    } else if (pgError.code === '23503') {
      statusCode = 400;
      message = 'Foreign key constraint violation';
      severity = 'warning';
    }

    if (process.env.NODE_ENV === 'development') {
      details = {
        code: pgError.code,
        detail: pgError.detail,
        table: pgError.table,
      };
    }
  }

  // Handle JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    severity = 'warning';
    isOperational = true;
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    severity = 'warning';
    isOperational = true;
  }

  // Handle validation errors
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = err.message;
    severity = 'warning';
    isOperational = true;
  }

  // Handle syntax errors (bad JSON)
  else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON payload';
    severity = 'warning';
    isOperational = true;
  }

  // Handle network/external service errors
  else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
    statusCode = 503;
    message = 'External service unavailable';
    severity = 'error';
  }

  // Handle timeout errors
  else if (err.message.includes('timeout')) {
    statusCode = 408;
    message = 'Request timeout';
    severity = 'warning';
  }

  // Extract user context if available
  const userContext = extractUserContext(req);

  // Log error details
  logError(err, req, {
    statusCode,
    isOperational,
    severity,
    userContext,
  });

  // Send error response
  const errorResponse: any = {
    error: {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    },
  };

  // Add additional details if available
  if (details) {
    errorResponse.error.details = details;
  }

  // Add stack trace in development
  if (stack && process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = stack.split('\n');
  }

  // Add request ID if available
  if (req.headers['x-request-id']) {
    errorResponse.error.requestId = req.headers['x-request-id'];
  }

  res.status(statusCode).json(errorResponse);
}

// 404 handler for undefined routes
export function notFoundHandler(req: Request, res: Response) {
  const userContext = extractUserContext(req);

  // Log 404 as info level to Sentry
  sentryService.captureMessage(
    `Route not found: ${req.method} ${req.path}`,
    'info',
    {
      request: req,
      user: userContext,
      tags: {
        error_type: 'not_found',
        method: req.method,
        path: req.path,
      },
    }
  );

  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      statusCode: 404,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
  });
}

// Error logging function with Sentry integration
function logError(
  err: Error,
  req: Request,
  context: {
    statusCode: number;
    isOperational: boolean;
    severity: 'error' | 'warning' | 'info' | 'fatal';
    userContext?: { id: string; email?: string; username?: string } | null;
  }
) {
  const errorInfo = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    headers: req.headers,
    body: req.body,
    query: req.query,
    params: req.params,
    timestamp: new Date().toISOString(),
    statusCode: context.statusCode,
    isOperational: context.isOperational,
  };

  // Determine if we should report to Sentry
  const shouldReportToSentry = shouldReportError(err, context);

  if (shouldReportToSentry) {
    // Add breadcrumb for context
    sentryService.addBreadcrumb(
      `Request: ${req.method} ${req.url}`,
      'request',
      'info',
      {
        method: req.method,
        url: req.url,
        statusCode: context.statusCode,
      }
    );

    // Report to Sentry with full context
    sentryService.captureException(err, {
      request: req,
      user: context.userContext,
      level: mapSeverityToSentryLevel(context.severity),
      tags: {
        error_type: err.constructor.name,
        status_code: context.statusCode.toString(),
        method: req.method,
        operational: context.isOperational.toString(),
        endpoint: req.route?.path || req.path,
      },
      extra: {
        requestId: req.headers['x-request-id'],
        userAgent: req.get('User-Agent'),
        referer: req.get('Referer'),
        errorDetails: err instanceof AppError ? err.details : undefined,
      },
    });
  }

  // Console logging based on environment
  if (process.env.NODE_ENV === 'production') {
    // Production: Only log essential info and errors
    if (context.statusCode >= 500 || !context.isOperational) {
      console.error('Production Error:', {
        message: err.message,
        url: req.url,
        method: req.method,
        statusCode: context.statusCode,
        timestamp: errorInfo.timestamp,
        requestId: req.headers['x-request-id'],
        userId: context.userContext?.id,
      });
    } else if (context.statusCode >= 400) {
      console.warn('Client Error:', {
        message: err.message,
        url: req.url,
        method: req.method,
        statusCode: context.statusCode,
        timestamp: errorInfo.timestamp,
      });
    }
  } else {
    // Development: Log full error details
    console.error('Development Error:', errorInfo);
  }
}

// Determine if error should be reported to Sentry
function shouldReportError(
  err: Error,
  context: {
    statusCode: number;
    isOperational: boolean;
    severity: 'error' | 'warning' | 'info' | 'fatal';
  }
): boolean {
  // Don't report if Sentry is not enabled
  if (!sentryService.isEnabled()) {
    return false;
  }

  // Always report fatal errors and non-operational errors
  if (context.severity === 'fatal' || !context.isOperational) {
    return true;
  }

  // Report 5xx errors
  if (context.statusCode >= 500) {
    return true;
  }

  // Report authentication/authorization issues for monitoring
  if (context.statusCode === 401 || context.statusCode === 403) {
    return true;
  }

  // Report rate limit errors for monitoring
  if (context.statusCode === 429) {
    return true;
  }

  // Don't report common 4xx errors
  if (context.statusCode >= 400 && context.statusCode < 500) {
    return false;
  }

  // Report anything else as a precaution
  return true;
}

// Map our severity levels to Sentry levels
function mapSeverityToSentryLevel(
  severity: 'error' | 'warning' | 'info' | 'fatal'
): 'fatal' | 'error' | 'warning' | 'info' | 'debug' {
  const mapping = {
    fatal: 'fatal' as const,
    error: 'error' as const,
    warning: 'warning' as const,
    info: 'info' as const,
  };

  return mapping[severity] || 'error';
}

// Extract user context from request
function extractUserContext(req: Request): { id: string; email?: string; username?: string } | null {
  // Try to extract user from JWT token or session
  const user = (req as any).user;

  if (user) {
    return {
      id: user.id || user.userId || user.sub,
      email: user.email,
      username: user.username || user.name,
    };
  }

  // Try to extract from headers
  const userId = req.headers['x-user-id'] as string;
  if (userId) {
    return {
      id: userId,
      email: req.headers['x-user-email'] as string,
      username: req.headers['x-username'] as string,
    };
  }

  return null;
}

// Request timeout middleware
export function timeoutHandler(timeout: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      const error = new AppError('Request timeout', 408, true, { timeout: `${timeout}ms` });

      // Log timeout to Sentry
      const userContext = extractUserContext(req);
      sentryService.captureException(error, {
        request: req,
        user: userContext,
        level: 'warning',
        tags: {
          error_type: 'timeout',
          timeout_ms: timeout.toString(),
        },
      });

      res.status(408).json({
        error: {
          message: 'Request timeout',
          statusCode: 408,
          timeout: `${timeout}ms`,
          timestamp: new Date().toISOString(),
        },
      });
    }, timeout);

    res.on('finish', () => {
      clearTimeout(timeoutId);
    });

    next();
  };
}

// Validation error formatter
export function formatValidationErrors(errors: ValidationError[]): any {
  return errors.map(error => ({
    field: (error as any).param || 'unknown',
    message: (error as any).msg || error.toString(),
    value: (error as any).value,
  }));
}

// Graceful error handling for async operations
export function handleAsyncError(operation: string) {
  return (error: Error) => {
    console.error(`Async operation failed: ${operation}`, error);

    sentryService.captureException(error, {
      level: 'error',
      tags: {
        error_type: 'async_operation',
        operation,
      },
    });
  };
}

// Initialize Sentry when this module is loaded
sentryService.initialize();