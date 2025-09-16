import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Request, Response, NextFunction } from 'express';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray',
};

// Add colors to winston
winston.addColors(colors);

// Define format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

// Define format for console (development)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message}${metaString}`;
  }),
);

// Define transports
const transports: winston.transport[] = [];

// Console transport (always enabled in development)
if (process.env.NODE_ENV !== 'production' || process.env.LOG_TO_CONSOLE === 'true') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || 'debug',
    })
  );
}

// File transports with rotation
const fileRotateOptions = {
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format,
};

// Error log file
transports.push(
  new DailyRotateFile({
    ...fileRotateOptions,
    filename: 'logs/error-%DATE%.log',
    level: 'error',
  })
);

// Combined log file
transports.push(
  new DailyRotateFile({
    ...fileRotateOptions,
    filename: 'logs/combined-%DATE%.log',
    level: process.env.LOG_LEVEL || 'info',
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create specialized loggers
export const httpLogger = winston.createLogger({
  level: 'http',
  format,
  transports: [
    new DailyRotateFile({
      ...fileRotateOptions,
      filename: 'logs/http-%DATE%.log',
      level: 'http',
    }),
  ],
});

export const translationLogger = winston.createLogger({
  level: 'info',
  format,
  transports: [
    new DailyRotateFile({
      ...fileRotateOptions,
      filename: 'logs/translation-%DATE%.log',
      level: 'info',
    }),
  ],
});

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log request
  httpLogger.http({
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    requestId: req.headers['x-request-id'],
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    httpLogger.http({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length'),
      requestId: req.headers['x-request-id'],
    });
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
      });
    }
  });
  
  next();
};

// Helper functions for structured logging
export const log = {
  error: (message: string, meta?: any) => {
    logger.error(message, meta);
  },
  
  warn: (message: string, meta?: any) => {
    logger.warn(message, meta);
  },
  
  info: (message: string, meta?: any) => {
    logger.info(message, meta);
  },
  
  http: (message: string, meta?: any) => {
    logger.http(message, meta);
  },
  
  debug: (message: string, meta?: any) => {
    logger.debug(message, meta);
  },
  
  // Log translation events
  translation: (event: string, data: any) => {
    translationLogger.info(event, data);
  },
  
  // Log API errors with context
  apiError: (error: Error, req: Request, context?: any) => {
    logger.error('API Error', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params,
        ip: req.ip,
      },
      context,
    });
  },
  
  // Log external service errors
  serviceError: (service: string, error: Error, context?: any) => {
    logger.error(`External service error: ${service}`, {
      service,
      error: {
        message: error.message,
        stack: error.stack,
      },
      context,
    });
  },
  
  // Log performance metrics
  performance: (operation: string, duration: number, meta?: any) => {
    const level = duration > 5000 ? 'warn' : 'info';
    logger[level](`Performance: ${operation}`, {
      operation,
      duration: `${duration}ms`,
      ...meta,
    });
  },
  
  // Log cache events
  cache: (event: string, key: string, meta?: any) => {
    logger.debug(`Cache ${event}`, {
      event,
      key,
      ...meta,
    });
  },
  
  // Log database queries (in development)
  query: (sql: string, params?: any[], duration?: number) => {
    if (process.env.NODE_ENV === 'development') {
      logger.debug('Database query', {
        sql,
        params,
        duration: duration ? `${duration}ms` : undefined,
      });
    }
  },
  
  // Log authentication events
  auth: (event: string, userId?: string, meta?: any) => {
    logger.info(`Auth: ${event}`, {
      event,
      userId,
      ...meta,
    });
  },
  
  // Log billing events
  billing: (event: string, workspaceId: string, meta?: any) => {
    logger.info(`Billing: ${event}`, {
      event,
      workspaceId,
      ...meta,
    });
  },
};

// Stream for Morgan HTTP logger integration
export const morganStream = {
  write: (message: string) => {
    httpLogger.http(message.trim());
  },
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing log files');
  logger.end();
});

export default logger;