import { Request, Response, NextFunction } from 'express';
import { ValidationError } from 'express-validator';

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

  // Handle known operational errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
    
    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      stack = err.stack;
    }
  }
  
  // Handle Postgres errors
  else if (err.name === 'QueryFailedError' || err.constructor.name === 'QueryFailedError') {
    statusCode = 400;
    message = 'Database query failed';
    
    // Handle specific Postgres error codes
    const pgError = err as any;
    if (pgError.code === '23505') {
      statusCode = 409;
      message = 'Duplicate entry';
    } else if (pgError.code === '23503') {
      statusCode = 400;
      message = 'Foreign key constraint violation';
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
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }
  
  // Handle validation errors
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = err.message;
  }
  
  // Handle syntax errors (bad JSON)
  else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    message = 'Invalid JSON payload';
  }
  
  // Log error details
  logError(err, req);
  
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

// Error logging function
function logError(err: Error, req: Request) {
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
  };
  
  // In production, you'd send this to a logging service
  if (process.env.NODE_ENV === 'production') {
    // TODO: Send to logging service (e.g., Sentry, LogRocket)
    console.error('Production Error:', {
      message: err.message,
      url: req.url,
      method: req.method,
      timestamp: errorInfo.timestamp,
    });
  } else {
    console.error('Development Error:', errorInfo);
  }
}

// Request timeout middleware
export function timeoutHandler(timeout: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      res.status(408).json({
        error: {
          message: 'Request timeout',
          statusCode: 408,
          timeout: `${timeout}ms`,
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