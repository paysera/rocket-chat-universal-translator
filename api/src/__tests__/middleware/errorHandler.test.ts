import { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  notFoundHandler,
  timeoutHandler,
  AppError,
  ValidationAppError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  formatValidationErrors,
  handleAsyncError,
} from '../../middleware/errorHandler';
import { sentryService } from '../../services/sentryService';

// Mock Sentry service
jest.mock('../../services/sentryService', () => ({
  sentryService: {
    initialize: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
    captureException: jest.fn().mockReturnValue('sentry-id-123'),
    captureMessage: jest.fn().mockReturnValue('sentry-id-456'),
    addBreadcrumb: jest.fn(),
    setUser: jest.fn(),
    setTags: jest.fn(),
    close: jest.fn().mockResolvedValue(true),
  },
}));

describe('Error Handler Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      url: '/test',
      path: '/test',
      ip: '127.0.0.1',
      headers: {},
      body: {},
      query: {},
      params: {},
      get: jest.fn(),
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn(),
    };

    mockNext = jest.fn();

    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('AppError handling', () => {
    it('should handle AppError with correct status and message', () => {
      const error = new AppError('Test error', 400, true, { detail: 'test detail' });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Test error',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          details: { detail: 'test detail' },
        },
      });
    });

    it('should not report 4xx operational errors to Sentry', () => {
      const error = new AppError('Client error', 400, true);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).not.toHaveBeenCalled();
    });

    it('should report server errors to Sentry with error level', () => {
      const error = new AppError('Server error', 500, true);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalledWith(error, {
        request: mockRequest,
        user: undefined,
        level: 'error',
        tags: {
          error_type: 'AppError',
          status_code: '500',
          method: 'GET',
          operational: 'true',
          endpoint: '/test',
        },
        extra: {
          requestId: undefined,
          userAgent: undefined,
          referer: undefined,
          errorDetails: undefined,
        },
      });
    });
  });

  describe('Custom error classes', () => {
    it('should handle ValidationAppError', () => {
      const validationErrors = [
        { param: 'email', msg: 'Invalid email', value: 'invalid' } as any,
      ];
      const error = new ValidationAppError('Validation failed', validationErrors);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Validation failed',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          details: validationErrors,
        },
      });
    });

    it('should handle AuthenticationError', () => {
      const error = new AuthenticationError('Invalid credentials');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(sentryService.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({
            status_code: '401',
          }),
        })
      );
    });

    it('should handle AuthorizationError', () => {
      const error = new AuthorizationError('Access denied');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    it('should handle NotFoundError', () => {
      const error = new NotFoundError('User');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    it('should handle ConflictError', () => {
      const error = new ConflictError('Email already exists');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
    });

    it('should handle RateLimitError', () => {
      const error = new RateLimitError('Too many requests', 60);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(sentryService.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          level: 'warning',
        })
      );
    });

    it('should handle ExternalServiceError', () => {
      const error = new ExternalServiceError('OpenAI', { code: 'ECONNREFUSED' });

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
    });
  });

  describe('Database errors', () => {
    it('should handle QueryFailedError with duplicate key', () => {
      const error = new Error('Duplicate key error') as any;
      error.name = 'QueryFailedError';
      error.code = '23505';
      error.detail = 'Key (email)=(test@test.com) already exists.';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Duplicate entry',
          statusCode: 409,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
        },
      });
    });

    it('should handle QueryFailedError with foreign key constraint', () => {
      const error = new Error('Foreign key error') as any;
      error.name = 'QueryFailedError';
      error.code = '23503';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Foreign key constraint violation',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
        },
      });
    });
  });

  describe('JWT errors', () => {
    it('should handle JsonWebTokenError', () => {
      const error = new Error('Invalid token');
      error.name = 'JsonWebTokenError';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Invalid token',
          statusCode: 401,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
        },
      });
    });

    it('should handle TokenExpiredError', () => {
      const error = new Error('Token expired');
      error.name = 'TokenExpiredError';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe('User context extraction', () => {
    it('should extract user context from request.user', () => {
      mockRequest.user = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      } as any;

      const error = new AppError('Test error', 500);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          user: {
            id: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
          },
        })
      );
    });

    it('should extract user context from headers', () => {
      mockRequest.headers = {
        'x-user-id': 'user-456',
        'x-user-email': 'header@example.com',
        'x-username': 'headeruser',
      };

      const error = new AppError('Test error', 500);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          user: {
            id: 'user-456',
            email: 'header@example.com',
            username: 'headeruser',
          },
        })
      );
    });
  });

  describe('Request ID handling', () => {
    it('should include request ID in response when available', () => {
      mockRequest.headers = { 'x-request-id': 'req-123' };
      const error = new AppError('Test error', 400);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Test error',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          requestId: 'req-123',
        },
      });
    });
  });

  describe('Development vs Production logging', () => {
    it('should include stack trace in development', () => {
      process.env.NODE_ENV = 'development';
      const error = new AppError('Test error', 400);
      error.stack = 'Error: Test error\n    at test';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Test error',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
          stack: ['Error: Test error', '    at test'],
        },
      });
    });

    it('should not include stack trace in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new AppError('Test error', 400);
      error.stack = 'Error: Test error\n    at test';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          message: 'Test error',
          statusCode: 400,
          timestamp: expect.any(String),
          path: '/test',
          method: 'GET',
        },
      });
    });
  });

  describe('Sentry filtering', () => {
    beforeEach(() => {
      (sentryService.isEnabled as jest.Mock).mockReturnValue(true);
    });

    it('should not report 4xx client errors to Sentry', () => {
      const error = new AppError('Bad request', 400, true);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).not.toHaveBeenCalled();
    });

    it('should report 401 errors to Sentry for monitoring', () => {
      const error = new AuthenticationError('Invalid token');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should report 403 errors to Sentry for monitoring', () => {
      const error = new AuthorizationError('Access denied');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should report 429 errors to Sentry for monitoring', () => {
      const error = new RateLimitError('Too many requests');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should report 5xx errors to Sentry', () => {
      const error = new AppError('Server error', 500, true);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should report non-operational errors to Sentry', () => {
      const error = new AppError('Unexpected error', 400, false);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should not report when Sentry is disabled', () => {
      (sentryService.isEnabled as jest.Mock).mockReturnValue(false);
      const error = new AppError('Server error', 500, true);

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(sentryService.captureException).not.toHaveBeenCalled();
    });
  });
});

describe('Not Found Handler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockRequest = {
      method: 'GET',
      path: '/nonexistent',
      headers: {}, // Add headers to prevent undefined error
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    jest.clearAllMocks();
  });

  it('should return 404 with proper error structure', () => {
    notFoundHandler(mockRequest as Request, mockResponse as Response);

    expect(mockResponse.status).toHaveBeenCalledWith(404);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Endpoint not found',
        statusCode: 404,
        path: '/nonexistent',
        method: 'GET',
        timestamp: expect.any(String),
      },
    });
  });

  it('should log to Sentry as info level', () => {
    notFoundHandler(mockRequest as Request, mockResponse as Response);

    expect(sentryService.captureMessage).toHaveBeenCalledWith(
      'Route not found: GET /nonexistent',
      'info',
      expect.objectContaining({
        request: mockRequest,
        tags: {
          error_type: 'not_found',
          method: 'GET',
          path: '/nonexistent',
        },
      })
    );
  });
});

describe('Timeout Handler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.useFakeTimers();

    mockRequest = {
      method: 'GET',
      url: '/slow-endpoint',
      headers: {}, // Add headers to prevent undefined error
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn(),
    };

    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should trigger timeout after specified duration', () => {
    const timeoutMiddleware = timeoutHandler(1000);
    timeoutMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(mockResponse.status).toHaveBeenCalledWith(408);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: {
        message: 'Request timeout',
        statusCode: 408,
        timeout: '1000ms',
        timestamp: expect.any(String),
      },
    });
  });

  it('should report timeout to Sentry', () => {
    const timeoutMiddleware = timeoutHandler(1000);
    timeoutMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

    jest.advanceTimersByTime(1000);

    expect(sentryService.captureException).toHaveBeenCalledWith(
      expect.any(AppError),
      expect.objectContaining({
        level: 'warning',
        tags: {
          error_type: 'timeout',
          timeout_ms: '1000',
        },
      })
    );
  });
});

describe('Utility Functions', () => {
  describe('formatValidationErrors', () => {
    it('should format validation errors correctly', () => {
      const errors = [
        { param: 'email', msg: 'Invalid email', value: 'invalid-email' },
        { param: 'password', msg: 'Too short', value: '123' },
      ] as any;

      const formatted = formatValidationErrors(errors);

      expect(formatted).toEqual([
        { field: 'email', message: 'Invalid email', value: 'invalid-email' },
        { field: 'password', message: 'Too short', value: '123' },
      ]);
    });
  });

  describe('handleAsyncError', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      jest.clearAllMocks();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log error and report to Sentry', () => {
      const error = new Error('Async operation failed');
      const handler = handleAsyncError('database-connection');

      handler(error);

      expect(console.error).toHaveBeenCalledWith(
        'Async operation failed: database-connection',
        error
      );

      expect(sentryService.captureException).toHaveBeenCalledWith(error, {
        level: 'error',
        tags: {
          error_type: 'async_operation',
          operation: 'database-connection',
        },
      });
    });
  });
});