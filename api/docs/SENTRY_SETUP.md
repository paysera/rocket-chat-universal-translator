# Sentry Error Logging Setup Guide

This guide covers how to set up and use Sentry for production-ready error logging in the Universal Translator API.

## Table of Contents

- [Overview](#overview)
- [Sentry Account Setup](#sentry-account-setup)
- [Environment Configuration](#environment-configuration)
- [Features](#features)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

The Universal Translator API includes comprehensive error logging with Sentry integration that provides:

- **Automatic error capture** with context (request, user, environment)
- **Performance monitoring** with profiling and tracing
- **Data sanitization** to prevent sensitive information leakage
- **Environment-aware configuration** (development/staging/production)
- **Custom error classification** with severity levels
- **Breadcrumb tracking** for debugging context

## Sentry Account Setup

1. **Create a Sentry Account**
   - Go to [sentry.io](https://sentry.io) and create an account
   - Create a new organization or use an existing one

2. **Create a Project**
   - Click "Create Project"
   - Select "Node.js" as the platform
   - Name your project (e.g., "universal-translator-api")
   - Choose your team

3. **Get Your DSN**
   - After project creation, you'll see the DSN (Data Source Name)
   - It looks like: `https://[key]@[organization].ingest.sentry.io/[project-id]`
   - Copy this DSN for configuration

4. **Configure Project Settings**
   - Set up alerts and notifications
   - Configure release tracking
   - Set up performance monitoring (optional)

## Environment Configuration

### Development Environment

```bash
# .env (development)
NODE_ENV=development
SENTRY_DSN=https://your-dev-dsn@sentry.io/project-id
SENTRY_ENABLE_PROFILING=false
SENTRY_ENABLE_TRACING=false
SENTRY_SAMPLE_RATE=0.1
SENTRY_TRACES_SAMPLE_RATE=0.0
SENTRY_PROFILES_SAMPLE_RATE=0.0
```

**Note:** In development, Sentry won't initialize even with a DSN configured.

### Staging Environment

```bash
# .env.staging
NODE_ENV=staging
SENTRY_DSN=https://your-staging-dsn@sentry.io/project-id
SENTRY_ENABLE_PROFILING=true
SENTRY_ENABLE_TRACING=true
SENTRY_SAMPLE_RATE=1.0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
APP_VERSION=1.0.0-staging
SERVER_NAME=translation-api-staging
```

### Production Environment

```bash
# .env.production
NODE_ENV=production
SENTRY_DSN=https://your-production-dsn@sentry.io/project-id
SENTRY_ENABLE_PROFILING=true
SENTRY_ENABLE_TRACING=true
SENTRY_SAMPLE_RATE=1.0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
APP_VERSION=1.0.0
SERVER_NAME=translation-api-prod
```

### Configuration Options

| Variable | Description | Default | Recommended |
|----------|-------------|---------|-------------|
| `SENTRY_DSN` | Sentry project DSN | `undefined` | Required for production |
| `SENTRY_ENABLE_PROFILING` | Enable CPU profiling | `false` | `true` in production |
| `SENTRY_ENABLE_TRACING` | Enable performance tracing | `false` | `true` in production |
| `SENTRY_SAMPLE_RATE` | Error sampling rate (0.0-1.0) | `1.0` | `1.0` (capture all errors) |
| `SENTRY_TRACES_SAMPLE_RATE` | Performance trace sampling | `0.1` | `0.1` (10% of transactions) |
| `SENTRY_PROFILES_SAMPLE_RATE` | Profiling sampling rate | `0.1` | `0.1` (10% of transactions) |

## Features

### Automatic Error Capture

The error handler automatically captures and reports:

- **Server errors (5xx)** - Always reported
- **Authentication errors (401)** - Reported for security monitoring
- **Authorization errors (403)** - Reported for security monitoring
- **Rate limiting errors (429)** - Reported for monitoring
- **Non-operational errors** - Always reported regardless of status code

### Data Sanitization

Sensitive data is automatically filtered from:

- Request headers (authorization, cookies, API keys)
- Request body (passwords, tokens, credentials)
- Query parameters (tokens, secrets)
- Breadcrumb data

Filtered fields include:
```javascript
const SENSITIVE_FIELDS = [
  'password', 'token', 'authorization', 'cookie',
  'x-api-key', 'api-key', 'secret', 'private',
  'credential', 'auth', 'jwt', 'bearer'
];
```

### User Context

User information is automatically extracted from:
- `req.user` object (from authentication middleware)
- Request headers (`x-user-id`, `x-user-email`, `x-username`)

### Request Context

Each error includes:
- HTTP method and URL
- Request headers (sanitized)
- Query parameters (sanitized)
- Request body (sanitized)
- IP address
- User agent
- Request ID (if available)

## Usage Examples

### Basic Error Handling

```typescript
import { asyncHandler, AppError } from './middleware/errorHandler';

export const translateText = asyncHandler(async (req: Request, res: Response) => {
  const { text, targetLanguage } = req.body;

  if (!text) {
    // This will be automatically logged to Sentry if appropriate
    throw new AppError('Text is required for translation', 400, true);
  }

  // Your translation logic here
});
```

### Manual Error Reporting

```typescript
import { sentryService } from './services/sentryService';

try {
  await criticalOperation();
} catch (error) {
  // Report with additional context
  sentryService.captureException(error, {
    level: 'fatal',
    tags: {
      component: 'critical-system',
      operation: 'data-sync',
    },
    extra: {
      operationId: 'sync-123',
      timestamp: new Date().toISOString(),
    },
  });

  throw error;
}
```

### Adding Breadcrumbs

```typescript
// Add context for debugging
sentryService.addBreadcrumb(
  'User initiated translation',
  'user-action',
  'info',
  {
    textLength: text.length,
    targetLanguage: 'es',
    userId: req.user.id,
  }
);
```

### Setting User Context

```typescript
// Set user context for all subsequent errors
sentryService.setUser({
  id: user.id,
  email: user.email,
  username: user.username,
});
```

### Performance Monitoring

```typescript
// Monitor slow operations
@monitorPerformance('translation-process')
async translateLargeDocument(document: string) {
  // This will automatically report if operation takes > 5 seconds
  return await processDocument(document);
}
```

## Testing

### Running Tests

```bash
# Run error handler tests
npm test -- errorHandler.test.ts

# Run Sentry service tests
npm test -- sentryService.test.ts

# Run all error-related tests
npm test -- --testPathPattern="error|sentry"
```

### Manual Testing

1. **Test Error Reporting** (staging environment):
   ```bash
   curl -X POST http://localhost:3001/api/test-error \
     -H "Content-Type: application/json" \
     -d '{"type": "server_error"}'
   ```

2. **Test User Context**:
   ```bash
   curl -X POST http://localhost:3001/api/test-error \
     -H "Content-Type: application/json" \
     -H "x-user-id: test-user-123" \
     -d '{"type": "auth_error"}'
   ```

3. **Check Sentry Dashboard** for reported errors

### Development Testing

Create a test endpoint for development:

```typescript
// Only in development/staging
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/test-error', (req, res) => {
    const { type } = req.body;

    switch (type) {
      case 'server_error':
        throw new Error('Test server error');
      case 'auth_error':
        throw new AuthenticationError('Test auth error');
      case 'custom_error':
        throw new AppError('Test custom error', 400, true);
      default:
        throw new Error('Unknown error type');
    }
  });
}
```

## Best Practices

### 1. Error Classification

Use appropriate error classes:

```typescript
// For client errors (user input issues)
throw new AppError('Invalid email format', 400, true);

// For authentication issues
throw new AuthenticationError('Invalid credentials');

// For external service failures
throw new ExternalServiceError('OpenAI API', originalError);
```

### 2. Contextual Information

Always provide context:

```typescript
sentryService.addBreadcrumb(
  'Starting translation process',
  'translation',
  'info',
  { provider: 'openai', textLength: text.length }
);
```

### 3. Sensitive Data Handling

Never log sensitive information:

```typescript
// ❌ Bad - logs sensitive data
sentryService.captureException(error, {
  extra: { userPassword: password, apiKey: key }
});

// ✅ Good - safe context
sentryService.captureException(error, {
  extra: { userId: user.id, operation: 'login' }
});
```

### 4. Performance Considerations

- Use appropriate sampling rates
- Monitor Sentry quota usage
- Filter out noisy errors

### 5. Alert Configuration

Set up alerts in Sentry for:
- High error rates
- New error types
- Performance degradation
- Security-related errors (401/403)

## Troubleshooting

### Common Issues

1. **Sentry not initializing**
   ```
   Error: Sentry not initialized: Missing DSN or development environment
   ```
   - Check `SENTRY_DSN` environment variable
   - Verify `NODE_ENV` is not 'development'

2. **Errors not appearing in Sentry**
   - Check network connectivity
   - Verify DSN is correct
   - Check error sampling rate
   - Ensure error meets reporting criteria

3. **Too many events (quota exceeded)**
   - Reduce sampling rates
   - Filter out noisy errors
   - Implement error deduplication

4. **Sensitive data in logs**
   - Review sanitization rules
   - Check custom error reporting
   - Verify beforeSend hook

### Debug Mode

Enable debug logging:

```typescript
// In development
if (process.env.NODE_ENV === 'development') {
  Sentry.init({
    debug: true,
    // ... other options
  });
}
```

### Health Check

Create a health check endpoint:

```typescript
app.get('/health/sentry', (req, res) => {
  res.json({
    sentryEnabled: sentryService.isEnabled(),
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});
```

## Support

- **Sentry Documentation**: [docs.sentry.io](https://docs.sentry.io)
- **Node.js SDK Guide**: [docs.sentry.io/platforms/node](https://docs.sentry.io/platforms/node)
- **API Reference**: Check `src/services/sentryService.ts` and `src/middleware/errorHandler.ts`

## Migration Guide

If migrating from console logging:

1. Install Sentry dependencies
2. Configure environment variables
3. Replace manual error logging with structured error classes
4. Add user context extraction to authentication middleware
5. Test in staging environment before production deployment

## Security Considerations

- **DSN Protection**: Treat DSN as sensitive data (don't expose in client-side code)
- **Data Sanitization**: Regularly review what data is being sent to Sentry
- **Access Control**: Limit Sentry project access to authorized team members
- **GDPR Compliance**: Configure data retention and deletion policies