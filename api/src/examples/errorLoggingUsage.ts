/**
 * Example usage of error logging and Sentry integration
 * This file demonstrates how to use the error handling system throughout the application
 */

import { Request, Response } from 'express';
import { sentryService } from '../services/sentryService';
import {
  AppError,
  ExternalServiceError,
  AuthenticationError,
  handleAsyncError,
  asyncHandler,
} from '../middleware/errorHandler';

// Example 1: Using custom error classes in route handlers
export const translateText = asyncHandler(async (req: Request, res: Response) => {
  const { text, targetLanguage } = req.body;

  if (!text) {
    throw new AppError('Text is required for translation', 400, true);
  }

  if (!targetLanguage) {
    throw new AppError('Target language is required', 400, true);
  }

  try {
    // Simulate external API call
    const result = await callTranslationAPI(text, targetLanguage);

    // Add breadcrumb for successful operation
    sentryService.addBreadcrumb(
      'Translation completed successfully',
      'translation',
      'info',
      {
        textLength: text.length,
        targetLanguage,
        provider: 'openai',
      }
    );

    res.json({ translatedText: result });
  } catch (error) {
    // Wrap external service errors
    throw new ExternalServiceError('OpenAI Translation API', error);
  }
});

// Example 2: Manual error reporting with context
export const processUserData = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId;

  try {
    // Set user context for all subsequent errors
    sentryService.setUser({
      id: userId,
      email: req.user?.email,
      username: req.user?.username,
    });

    const userData = await getUserData(userId);

    if (!userData) {
      // This will be automatically reported to Sentry with user context
      throw new AppError('User data not found', 404, true);
    }

    // Process the data...
    const processedData = await processData(userData);

    res.json(processedData);
  } catch (error) {
    // For critical business logic errors, add extra context
    if (error instanceof Error && error.message.includes('data corruption')) {
      sentryService.captureException(error, {
        level: 'fatal',
        tags: {
          component: 'data-processor',
          critical: 'true',
        },
        extra: {
          userId,
          errorContext: 'Data corruption detected during processing',
          timestamp: new Date().toISOString(),
        },
      });
    }

    throw error; // Re-throw to let the global error handler deal with it
  }
});

// Example 3: Authentication middleware with error logging
export const authenticateUser = asyncHandler(async (req: Request, res: Response, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    // Log authentication attempts for security monitoring
    sentryService.captureMessage(
      'Authentication failed: No token provided',
      'warning',
      {
        request: req,
        tags: {
          security: 'authentication',
          reason: 'missing_token',
        },
        extra: {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.path,
        },
      }
    );

    throw new AuthenticationError('No token provided');
  }

  try {
    const user = await verifyToken(token);
    req.user = user;

    // Set user context for subsequent operations
    sentryService.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });

    next();
  } catch (error) {
    // Log failed authentication attempts
    sentryService.captureMessage(
      'Authentication failed: Invalid token',
      'warning',
      {
        request: req,
        tags: {
          security: 'authentication',
          reason: 'invalid_token',
        },
        extra: {
          tokenLength: token.length,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        },
      }
    );

    throw new AuthenticationError('Invalid token');
  }
});

// Example 4: Database operations with error handling
export class DatabaseService {
  async createUser(userData: any) {
    try {
      // Add breadcrumb for database operation
      sentryService.addBreadcrumb(
        'Creating new user',
        'database',
        'info',
        { email: userData.email }
      );

      const user = await this.db.user.create(userData);

      sentryService.addBreadcrumb(
        'User created successfully',
        'database',
        'info',
        { userId: user.id }
      );

      return user;
    } catch (error) {
      // Handle database-specific errors
      if (error.code === '23505') {
        throw new AppError('User with this email already exists', 409, true);
      }

      // For unexpected database errors, add context
      sentryService.captureException(error, {
        level: 'error',
        tags: {
          component: 'database',
          operation: 'create_user',
        },
        extra: {
          userData: {
            email: userData.email,
            // Don't log sensitive data
          },
        },
      });

      throw new AppError('Failed to create user', 500, false);
    }
  }
}

// Example 5: Background job error handling
export class TranslationQueue {
  async processTranslationJob(jobData: any) {
    const { jobId, text, targetLanguage, userId } = jobData;

    try {
      // Set context for the background job
      sentryService.setTags({
        component: 'background-job',
        job_type: 'translation',
        job_id: jobId,
      });

      sentryService.setUser({ id: userId });

      sentryService.addBreadcrumb(
        `Processing translation job ${jobId}`,
        'job',
        'info',
        { textLength: text.length, targetLanguage }
      );

      const result = await this.translateText(text, targetLanguage);

      // Update job status
      await this.updateJobStatus(jobId, 'completed', result);

      sentryService.addBreadcrumb(
        `Translation job ${jobId} completed`,
        'job',
        'info'
      );

    } catch (error) {
      // For background jobs, always report errors to Sentry
      sentryService.captureException(error, {
        level: 'error',
        tags: {
          component: 'background-job',
          job_type: 'translation',
          job_id: jobId,
          user_id: userId,
        },
        extra: {
          jobData: {
            jobId,
            textLength: text.length,
            targetLanguage,
            userId,
          },
        },
      });

      // Update job status to failed
      await this.updateJobStatus(jobId, 'failed', { error: error.message });

      throw error;
    }
  }
}

// Example 6: Async operation with error handler
export const performAsyncOperation = async () => {
  try {
    // Some async operation that might fail
    const result = await someAsyncOperation();
    return result;
  } catch (error) {
    // Use the async error handler for consistency
    handleAsyncError('async-operation')(error);
    throw error;
  }
};

// Example 7: API client with error wrapping
export class ExternalAPIClient {
  async makeRequest(url: string, options: any) {
    try {
      sentryService.addBreadcrumb(
        `Making external API request to ${url}`,
        'http',
        'info',
        { method: options.method || 'GET' }
      );

      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      // Wrap and enhance external API errors
      const enhancedError = new ExternalServiceError('External API', {
        originalError: error,
        url,
        method: options.method || 'GET',
        timestamp: new Date().toISOString(),
      });

      // Add additional context for external service failures
      sentryService.captureException(enhancedError, {
        level: 'error',
        tags: {
          component: 'external-api',
          service: 'unknown',
          endpoint: url,
        },
        extra: {
          requestOptions: {
            method: options.method || 'GET',
            headers: options.headers ? Object.keys(options.headers) : [],
          },
        },
      });

      throw enhancedError;
    }
  }
}

// Example 8: Performance monitoring with Sentry
export const monitorPerformance = (operationName: string) => {
  return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();

      sentryService.addBreadcrumb(
        `Starting ${operationName}`,
        'performance',
        'info'
      );

      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;

        sentryService.addBreadcrumb(
          `Completed ${operationName} in ${duration}ms`,
          'performance',
          'info',
          { duration }
        );

        // Report slow operations
        if (duration > 5000) {
          sentryService.captureMessage(
            `Slow operation detected: ${operationName}`,
            'warning',
            {
              tags: {
                performance: 'slow',
                operation: operationName,
              },
              extra: {
                duration,
                threshold: 5000,
              },
            }
          );
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        sentryService.captureException(error, {
          level: 'error',
          tags: {
            performance: 'failed',
            operation: operationName,
          },
          extra: {
            duration,
            args: args.length,
          },
        });

        throw error;
      }
    };
  };
};

// Dummy functions for examples (would be real implementations)
async function callTranslationAPI(text: string, targetLanguage: string): Promise<string> {
  // Simulate API call
  return `Translated: ${text}`;
}

async function getUserData(userId: string): Promise<any> {
  // Simulate database call
  return { id: userId, name: 'User' };
}

async function processData(data: any): Promise<any> {
  // Simulate data processing
  return { processed: true, data };
}

async function verifyToken(token: string): Promise<any> {
  // Simulate token verification
  return { id: 'user-123', email: 'user@example.com' };
}

async function someAsyncOperation(): Promise<any> {
  // Simulate async operation
  return { success: true };
}

// Usage examples in comments:
/*
// In your main application file (app.ts or index.ts):
import { sentryService } from './services/sentryService';

// Initialize Sentry early in your application
sentryService.initialize();

// Set global tags
sentryService.setTags({
  service: 'translation-api',
  version: process.env.APP_VERSION || '1.0.0',
});

// In your graceful shutdown handler:
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await sentryService.close(5000);
  process.exit(0);
});
*/