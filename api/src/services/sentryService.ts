import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { Request } from 'express';

// Configuration interface for Sentry
interface SentryConfig {
  dsn?: string;
  environment: string;
  enableProfiling: boolean;
  enableTracing: boolean;
  sampleRate: number;
  tracesSampleRate: number;
  profilesSampleRate: number;
  enableUserContext: boolean;
  enableRequestData: boolean;
  beforeSend?: (event: Sentry.Event, hint: Sentry.EventHint) => Sentry.Event | null;
}

// Default configuration
const defaultConfig: SentryConfig = {
  environment: process.env.NODE_ENV || 'development',
  enableProfiling: process.env.NODE_ENV === 'production',
  enableTracing: process.env.NODE_ENV === 'production',
  sampleRate: process.env.NODE_ENV === 'production' ? 1.0 : 0.1,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,
  enableUserContext: true,
  enableRequestData: true,
};

// Sensitive fields to filter from request data
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'secret',
  'private',
  'credential',
  'auth',
  'jwt',
  'bearer',
];

class SentryService {
  private initialized = false;
  private config: SentryConfig;

  constructor(config?: Partial<SentryConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Initialize Sentry with configuration
   */
  public initialize(): void {
    // Only initialize if DSN is provided and environment is staging/production
    if (!this.config.dsn || this.config.environment === 'development') {
      console.log('Sentry not initialized: Missing DSN or development environment');
      return;
    }

    if (this.initialized) {
      console.warn('Sentry already initialized');
      return;
    }

    const integrations: any[] = [
      Sentry.httpIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.requestDataIntegration({
        include: {
          cookies: false, // Don't include cookies for privacy
          data: this.config.enableRequestData,
          headers: this.config.enableRequestData,
          ip: true,
          query_string: this.config.enableRequestData,
          url: true,
          user: this.config.enableUserContext,
        },
      }),
    ];

    // Add profiling integration if enabled
    if (this.config.enableProfiling) {
      integrations.push(nodeProfilingIntegration());
    }

    Sentry.init({
      dsn: this.config.dsn,
      environment: this.config.environment,
      integrations,
      sampleRate: this.config.sampleRate,
      tracesSampleRate: this.config.tracesSampleRate,
      profilesSampleRate: this.config.profilesSampleRate,
      beforeSend: this.config.beforeSend || this.defaultBeforeSend.bind(this),
      beforeSendTransaction: (event) => {
        // Filter out health check transactions
        if (event.transaction?.includes('/health') || event.transaction?.includes('/metrics')) {
          return null;
        }
        return event;
      },
      release: process.env.APP_VERSION || '1.0.0',
      serverName: process.env.SERVER_NAME || 'translation-api',
    });

    this.initialized = true;
    console.log(`Sentry initialized for environment: ${this.config.environment}`);
  }

  /**
   * Check if Sentry is enabled and initialized
   */
  public isEnabled(): boolean {
    return this.initialized && this.config.environment !== 'development';
  }

  /**
   * Capture an exception with context
   */
  public captureException(
    error: Error,
    context?: {
      request?: Request;
      user?: { id: string; email?: string; username?: string };
      tags?: Record<string, string>;
      extra?: Record<string, any>;
      level?: Sentry.SeverityLevel;
    }
  ): string | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }

    return Sentry.withScope((scope) => {
      // Set severity level
      if (context?.level) {
        scope.setLevel(context.level);
      }

      // Set user context
      if (context?.user) {
        scope.setUser({
          id: context.user.id,
          email: context.user.email,
          username: context.user.username,
        });
      }

      // Set request context
      if (context?.request) {
        this.setRequestContext(scope, context.request);
      }

      // Set tags
      if (context?.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }

      // Set extra context
      if (context?.extra) {
        Object.entries(context.extra).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }

      return Sentry.captureException(error);
    });
  }

  /**
   * Capture a message with context
   */
  public captureMessage(
    message: string,
    level: Sentry.SeverityLevel = 'info',
    context?: {
      request?: Request;
      user?: { id: string; email?: string; username?: string };
      tags?: Record<string, string>;
      extra?: Record<string, any>;
    }
  ): string | undefined {
    if (!this.isEnabled()) {
      return undefined;
    }

    return Sentry.withScope((scope) => {
      scope.setLevel(level);

      if (context?.user) {
        scope.setUser({
          id: context.user.id,
          email: context.user.email,
          username: context.user.username,
        });
      }

      if (context?.request) {
        this.setRequestContext(scope, context.request);
      }

      if (context?.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }

      if (context?.extra) {
        Object.entries(context.extra).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }

      return Sentry.captureMessage(message, level);
    });
  }

  /**
   * Add breadcrumb for debugging
   */
  public addBreadcrumb(
    message: string,
    category?: string,
    level?: Sentry.SeverityLevel,
    data?: Record<string, any>
  ): void {
    if (!this.isEnabled()) {
      return;
    }

    Sentry.addBreadcrumb({
      message,
      category: category || 'custom',
      level: level || 'info',
      data: data ? this.sanitizeData(data) : undefined,
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Set user context globally
   */
  public setUser(user: { id: string; email?: string; username?: string }): void {
    if (!this.isEnabled()) {
      return;
    }

    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  }

  /**
   * Set tags globally
   */
  public setTags(tags: Record<string, string>): void {
    if (!this.isEnabled()) {
      return;
    }

    Object.entries(tags).forEach(([key, value]) => {
      Sentry.setTag(key, value);
    });
  }

  /**
   * Close Sentry connection (for graceful shutdown)
   */
  public async close(timeout: number = 2000): Promise<boolean> {
    if (!this.isEnabled()) {
      return true;
    }

    return Sentry.close(timeout);
  }

  /**
   * Default beforeSend filter to remove sensitive data
   */
  private defaultBeforeSend(event: Sentry.Event, hint: Sentry.EventHint): Sentry.Event | null {
    // Filter out client-side errors that might be spam
    if (event.exception) {
      const error = hint.originalException;
      if (error instanceof Error) {
        // Don't send certain types of errors
        if (this.shouldIgnoreError(error)) {
          return null;
        }
      }
    }

    // Sanitize request data
    if (event.request) {
      event.request = this.sanitizeRequest(event.request);
    }

    // Sanitize extra data
    if (event.extra) {
      event.extra = this.sanitizeData(event.extra);
    }

    return event;
  }

  /**
   * Check if error should be ignored
   */
  private shouldIgnoreError(error: Error): boolean {
    const ignoredMessages = [
      'Network request failed',
      'Non-Error promise rejection captured',
      'Request failed with status code 4', // 4xx errors
      'socket hang up',
      'ECONNRESET',
      'ECONNREFUSED',
    ];

    return ignoredMessages.some(ignored =>
      error.message.toLowerCase().includes(ignored.toLowerCase())
    );
  }

  /**
   * Set request context on Sentry scope
   */
  private setRequestContext(scope: Sentry.Scope, req: Request): void {
    scope.setTag('method', req.method);
    scope.setTag('url', req.url);
    scope.setTag('user_agent', req.get('User-Agent') || 'unknown');

    if (req.ip) {
      scope.setTag('ip', req.ip);
    }

    if (req.headers['x-request-id']) {
      scope.setTag('request_id', req.headers['x-request-id'] as string);
    }

    // Add sanitized request data
    scope.setExtra('request', {
      method: req.method,
      url: req.url,
      headers: this.sanitizeHeaders(req.headers),
      query: this.sanitizeData(req.query),
      params: this.sanitizeData(req.params),
      body: this.sanitizeData(req.body),
    });
  }

  /**
   * Sanitize request object
   */
  private sanitizeRequest(request: any): any {
    const sanitized = { ...request };

    if (sanitized.headers) {
      sanitized.headers = this.sanitizeHeaders(sanitized.headers);
    }

    if (sanitized.data) {
      sanitized.data = this.sanitizeData(sanitized.data);
    }

    if (sanitized.query_string) {
      sanitized.query_string = this.sanitizeQueryString(sanitized.query_string);
    }

    return sanitized;
  }

  /**
   * Sanitize headers to remove sensitive information
   */
  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    Object.entries(headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
        sanitized[key] = '[FILTERED]';
      } else {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  /**
   * Sanitize data object to remove sensitive fields
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }

    const sanitized: any = {};
    Object.entries(data).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
        sanitized[key] = '[FILTERED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeData(value);
      } else {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  /**
   * Sanitize query string
   */
  private sanitizeQueryString(queryString: string): string {
    if (!queryString) return queryString;

    return queryString.split('&').map(param => {
      const [key, value] = param.split('=');
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
        return `${key}=[FILTERED]`;
      }

      return param;
    }).join('&');
  }
}

// Export singleton instance
export const sentryService = new SentryService({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  enableProfiling: process.env.SENTRY_ENABLE_PROFILING === 'true',
  enableTracing: process.env.SENTRY_ENABLE_TRACING === 'true',
  sampleRate: process.env.SENTRY_SAMPLE_RATE ? parseFloat(process.env.SENTRY_SAMPLE_RATE) : undefined,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) : undefined,
  profilesSampleRate: process.env.SENTRY_PROFILES_SAMPLE_RATE ? parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE) : undefined,
});

export default sentryService;