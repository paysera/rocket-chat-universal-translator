import * as Sentry from '@sentry/node';
import { sentryService } from '../../services/sentryService';

// Mock Sentry
jest.mock('@sentry/node');
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn().mockReturnValue({}),
}));

const mockSentry = Sentry as jest.Mocked<typeof Sentry>;

describe('SentryService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.clearAllMocks();

    // Reset service state
    (sentryService as any).initialized = false;

    // Reset config to default for each test
    (sentryService as any).config = {
      environment: process.env.NODE_ENV || 'development',
      enableProfiling: process.env.NODE_ENV === 'production',
      enableTracing: process.env.NODE_ENV === 'production',
      sampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0.1,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
      enableUserContext: true,
      enableRequestData: true,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Initialization', () => {
    it('should initialize Sentry with correct configuration in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      process.env.SENTRY_ENABLE_PROFILING = 'true';
      process.env.SENTRY_ENABLE_TRACING = 'true';

      // Update config manually for test
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };

      sentryService.initialize();

      expect(mockSentry.init).toHaveBeenCalledWith({
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        integrations: expect.arrayContaining([
          expect.anything(), // httpIntegration
          expect.anything(), // onUncaughtExceptionIntegration
          expect.anything(), // onUnhandledRejectionIntegration
          expect.anything(), // requestDataIntegration
          expect.anything(), // nodeProfilingIntegration
        ]),
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        beforeSend: expect.any(Function),
        beforeSendTransaction: expect.any(Function),
        release: '1.0.0',
        serverName: 'translation-api',
      });
    });

    it('should not initialize Sentry in development environment', () => {
      process.env.NODE_ENV = 'development';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      sentryService.initialize();

      expect(mockSentry.init).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Sentry not initialized: Missing DSN or development environment'
      );

      consoleSpy.mockRestore();
    });

    it('should not initialize Sentry without DSN', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SENTRY_DSN;

      // Update config manually for test
      (sentryService as any).config = {
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      sentryService.initialize();

      expect(mockSentry.init).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Sentry not initialized: Missing DSN or development environment'
      );

      consoleSpy.mockRestore();
    });

    it('should not initialize twice', () => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config manually for test
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      sentryService.initialize();
      sentryService.initialize(); // Second call

      expect(mockSentry.init).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('Sentry already initialized');

      consoleSpy.mockRestore();
    });
  });

  describe('isEnabled', () => {
    it('should return true when initialized and not in development', () => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config manually for test
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };

      sentryService.initialize();

      expect(sentryService.isEnabled()).toBe(true);
    });

    it('should return false in development even when initialized', () => {
      process.env.NODE_ENV = 'development';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Force initialization for testing
      (sentryService as any).initialized = true;
      (sentryService as any).config.environment = 'development';

      expect(sentryService.isEnabled()).toBe(false);
    });

    it('should return false when not initialized', () => {
      expect(sentryService.isEnabled()).toBe(false);
    });
  });

  describe('captureException', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;

      // Simple mock - just return the value directly without complex scope mocking
      mockSentry.withScope.mockImplementation((callback: any) => {
        const mockScope = {
          setLevel: jest.fn(),
          setUser: jest.fn(),
          setTag: jest.fn(),
          setExtra: jest.fn(),
        };
        return callback(mockScope);
      });

      mockSentry.captureException.mockReturnValue('test-id');
    });

    it('should capture exception with basic context', () => {
      const error = new Error('Test error');

      const result = sentryService.captureException(error);

      expect(result).toBe('test-id');
      expect(mockSentry.withScope).toHaveBeenCalled();
      expect(mockSentry.captureException).toHaveBeenCalledWith(error);
    });

    it('should return undefined when disabled', () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      const error = new Error('Test error');
      const result = sentryService.captureException(error);

      expect(result).toBeUndefined();
      expect(mockSentry.captureException).not.toHaveBeenCalled();
    });
  });

  describe('captureMessage', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;

      // Simple mock - just return the value directly without complex scope mocking
      mockSentry.withScope.mockImplementation((callback: any) => {
        const mockScope = {
          setLevel: jest.fn(),
          setUser: jest.fn(),
          setTag: jest.fn(),
          setExtra: jest.fn(),
        };
        return callback(mockScope);
      });

      mockSentry.captureMessage.mockReturnValue('message-id');
    });

    it('should capture message with default info level', () => {
      const result = sentryService.captureMessage('Test message');

      expect(result).toBe('message-id');
      expect(mockSentry.captureMessage).toHaveBeenCalledWith('Test message', 'info');
    });

    it('should capture message with custom level', () => {
      const result = sentryService.captureMessage('Test warning', 'warning');

      expect(result).toBe('message-id');
      expect(mockSentry.captureMessage).toHaveBeenCalledWith('Test warning', 'warning');
    });

    it('should return undefined when disabled', () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      const result = sentryService.captureMessage('Test message');

      expect(result).toBeUndefined();
      expect(mockSentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('addBreadcrumb', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;
    });

    it('should add breadcrumb with default values', () => {
      sentryService.addBreadcrumb('User clicked button');

      expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith({
        message: 'User clicked button',
        category: 'custom',
        level: 'info',
        data: undefined,
        timestamp: expect.any(Number),
      });
    });

    it('should add breadcrumb with custom values and sanitized data', () => {
      const data = {
        userId: '123',
        password: 'secret',
        token: 'jwt-token',
        metadata: { safe: 'data' },
      };

      sentryService.addBreadcrumb(
        'User authenticated',
        'auth',
        'debug',
        data
      );

      expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith({
        message: 'User authenticated',
        category: 'auth',
        level: 'debug',
        data: {
          userId: '123',
          password: '[FILTERED]',
          token: '[FILTERED]',
          metadata: { safe: 'data' },
        },
        timestamp: expect.any(Number),
      });
    });

    it('should not add breadcrumb when disabled', () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      sentryService.addBreadcrumb('Test breadcrumb');

      expect(mockSentry.addBreadcrumb).not.toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;
    });

    it('should set user context', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      };

      sentryService.setUser(user);

      expect(mockSentry.setUser).toHaveBeenCalledWith(user);
    });

    it('should not set user when disabled', () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      const user = { id: 'user-123' };
      sentryService.setUser(user);

      expect(mockSentry.setUser).not.toHaveBeenCalled();
    });
  });

  describe('setTags', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;
    });

    it('should set multiple tags', () => {
      const tags = {
        component: 'api',
        version: '1.0.0',
        environment: 'production',
      };

      sentryService.setTags(tags);

      expect(mockSentry.setTag).toHaveBeenCalledTimes(3);
      expect(mockSentry.setTag).toHaveBeenCalledWith('component', 'api');
      expect(mockSentry.setTag).toHaveBeenCalledWith('version', '1.0.0');
      expect(mockSentry.setTag).toHaveBeenCalledWith('environment', 'production');
    });

    it('should not set tags when disabled', () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      sentryService.setTags({ component: 'api' });

      expect(mockSentry.setTag).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';

      // Update config and force initialization
      (sentryService as any).config = {
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        enableProfiling: true,
        enableTracing: true,
        sampleRate: 1.0,
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.1,
        enableUserContext: true,
        enableRequestData: true,
      };
      (sentryService as any).initialized = true;

      mockSentry.close.mockResolvedValue(true);
    });

    it('should close Sentry connection', async () => {
      const result = await sentryService.close(5000);

      expect(result).toBe(true);
      expect(mockSentry.close).toHaveBeenCalledWith(5000);
    });

    it('should close with default timeout', async () => {
      const result = await sentryService.close();

      expect(result).toBe(true);
      expect(mockSentry.close).toHaveBeenCalledWith(2000);
    });

    it('should return true when disabled', async () => {
      process.env.NODE_ENV = 'development';
      (sentryService as any).config.environment = 'development';

      const result = await sentryService.close();

      expect(result).toBe(true);
      expect(mockSentry.close).not.toHaveBeenCalled();
    });
  });

  describe('Environment Configuration', () => {
    it('should use environment variables for configuration', () => {
      process.env.NODE_ENV = 'staging';
      process.env.SENTRY_DSN = 'https://staging@sentry.io/123';
      process.env.SENTRY_ENABLE_PROFILING = 'true';
      process.env.SENTRY_ENABLE_TRACING = 'false';
      process.env.SENTRY_SAMPLE_RATE = '0.5';
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0.2';
      process.env.SENTRY_PROFILES_SAMPLE_RATE = '0.3';
      process.env.APP_VERSION = '2.0.0';
      process.env.SERVER_NAME = 'custom-server';

      // Update config manually for test
      (sentryService as any).config = {
        dsn: 'https://staging@sentry.io/123',
        environment: 'staging',
        enableProfiling: true,
        enableTracing: false,
        sampleRate: 0.5,
        tracesSampleRate: 0.2,
        profilesSampleRate: 0.3,
        enableUserContext: true,
        enableRequestData: true,
      };

      sentryService.initialize();

      expect(mockSentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://staging@sentry.io/123',
          environment: 'staging',
          sampleRate: 0.5,
          tracesSampleRate: 0.2,
          profilesSampleRate: 0.3,
          release: '2.0.0',
          serverName: 'custom-server',
        })
      );
    });
  });
});