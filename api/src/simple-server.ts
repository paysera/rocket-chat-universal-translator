import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import * as dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3030,http://localhost:3001').split(','),
  credentials: true
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger documentation
try {
  const swaggerDocument = YAML.load(path.join(__dirname, '../swagger.yml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (error) {
  console.error('Failed to load Swagger documentation:', error);
}

// Simple health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Simple ready check (without DB/Redis checks for now)
app.get('/readyz', (_req, res) => {
  res.status(200).json({
    status: 'ready',
    checks: {
      api: true,
      database: false, // Will implement later
      redis: false,    // Will implement later
      rocketchat: false // Will implement later
    },
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'Universal Translator API',
    version: '1.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/healthz',
      ready: '/readyz',
      docs: '/api-docs',
      translate: '/api/translate',
      detectLanguage: '/api/detect-language',
      languages: '/api/languages'
    }
  });
});

// API endpoints
app.post('/api/translate', (req, res) => {
  const { text, sourceLang, targetLang } = req.body;

  // Mock translation
  res.json({
    translatedText: `[Translated from ${sourceLang || 'auto'} to ${targetLang}]: ${text}`,
    sourceLang: sourceLang || 'en',
    targetLang: targetLang || 'lt',
    confidence: 0.95,
    provider: 'mock'
  });
});

app.post('/api/detect-language', (req, res) => {
  const { text } = req.body;

  // Simple language detection mock
  const language = text && text.toLowerCase().includes('hello') ? 'en' : 'lt';

  res.json({
    language,
    confidence: 0.98
  });
});

app.get('/api/languages', (_req, res) => {
  res.json({
    languages: [
      { code: 'en', name: 'English' },
      { code: 'lt', name: 'Lithuanian' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' }
    ]
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log('================================================');
  console.log(`✅ API Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/healthz`);
  console.log(`   Ready check: http://localhost:${PORT}/readyz`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('================================================');
});

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

export default app;