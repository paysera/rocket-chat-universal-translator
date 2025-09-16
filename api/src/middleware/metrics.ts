import { Request, Response, NextFunction } from 'express';
import promClient from 'prom-client';

// Create a Registry
const register = new promClient.Registry();

// Add default metrics (memory, cpu, gc, etc.)
promClient.collectDefaultMetrics({
  register,
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  eventLoopMonitoringPrecision: 5
});

// Custom metrics for Universal Translator
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'user_id'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'user_id'],
});

const translationCounter = new promClient.Counter({
  name: 'translations_total',
  help: 'Total number of translations performed',
  labelNames: ['source_lang', 'target_lang', 'provider', 'user_id', 'status'],
});

const translationDuration = new promClient.Histogram({
  name: 'translation_duration_seconds',
  help: 'Time taken to complete translation requests',
  labelNames: ['source_lang', 'target_lang', 'provider', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active HTTP connections',
});

const apiKeyUsage = new promClient.Counter({
  name: 'api_key_usage_total',
  help: 'Total API key usage by user',
  labelNames: ['user_id', 'api_key_id', 'endpoint'],
});

const rateLimitHits = new promClient.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['user_id', 'limit_type', 'endpoint'],
});

const errorCounter = new promClient.Counter({
  name: 'application_errors_total',
  help: 'Total number of application errors',
  labelNames: ['error_type', 'endpoint', 'severity'],
});

const databaseConnections = new promClient.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  labelNames: ['database_type'],
});

const redisOperations = new promClient.Counter({
  name: 'redis_operations_total',
  help: 'Total Redis operations',
  labelNames: ['operation', 'status'],
});

const cachehitRatio = new promClient.Gauge({
  name: 'cache_hit_ratio',
  help: 'Cache hit ratio percentage',
  labelNames: ['cache_type'],
});

// Register all metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(translationCounter);
register.registerMetric(translationDuration);
register.registerMetric(activeConnections);
register.registerMetric(apiKeyUsage);
register.registerMetric(rateLimitHits);
register.registerMetric(errorCounter);
register.registerMetric(databaseConnections);
register.registerMetric(redisOperations);
register.registerMetric(cachehitRatio);

// Middleware to track HTTP metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  // Track active connections
  activeConnections.inc();

  // Extract user ID from request (if available)
  const userId = (req as any).user?.id || 'anonymous';

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const statusCode = res.statusCode.toString();

    // Record HTTP metrics
    httpRequestDuration
      .labels(req.method, route, statusCode, userId)
      .observe(duration);

    httpRequestTotal
      .labels(req.method, route, statusCode, userId)
      .inc();

    activeConnections.dec();

    // Track API key usage if present
    if ((req as any).apiKey) {
      apiKeyUsage
        .labels(userId, (req as any).apiKey.id, route)
        .inc();
    }
  });

  next();
};

// Endpoint to expose metrics
export const metricsEndpoint = async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).end(error);
  }
};

// Export individual metric functions for use in services
export const incrementTranslationCounter = (
  sourceLang: string,
  targetLang: string,
  provider: string,
  userId: string = 'anonymous',
  status: 'success' | 'error' = 'success'
) => {
  translationCounter.labels(sourceLang, targetLang, provider, userId, status).inc();
};

export const recordTranslationDuration = (
  sourceLang: string,
  targetLang: string,
  provider: string,
  duration: number,
  status: 'success' | 'error' = 'success'
) => {
  translationDuration.labels(sourceLang, targetLang, provider, status).observe(duration);
};

export const incrementRateLimitHit = (
  userId: string,
  limitType: string,
  endpoint: string
) => {
  rateLimitHits.labels(userId, limitType, endpoint).inc();
};

export const incrementErrorCounter = (
  errorType: string,
  endpoint: string,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
) => {
  errorCounter.labels(errorType, endpoint, severity).inc();
};

export const setDatabaseConnections = (
  count: number,
  databaseType: string = 'postgresql'
) => {
  databaseConnections.labels(databaseType).set(count);
};

export const incrementRedisOperation = (
  operation: string,
  status: 'success' | 'error' = 'success'
) => {
  redisOperations.labels(operation, status).inc();
};

export const setCacheHitRatio = (
  ratio: number,
  cacheType: string = 'redis'
) => {
  cachehitRatio.labels(cacheType).set(ratio);
};

// Utility function to record business metrics
export const recordBusinessMetric = (metricName: string, value: number, labels: Record<string, string> = {}) => {
  const businessMetric = new promClient.Gauge({
    name: `business_${metricName}`,
    help: `Business metric: ${metricName}`,
    labelNames: Object.keys(labels),
  });

  if (!register.getSingleMetric(`business_${metricName}`)) {
    register.registerMetric(businessMetric);
  }

  businessMetric.labels(labels).set(value);
};

export { register };