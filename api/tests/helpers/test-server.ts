import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import path from 'path';

let app: express.Application;
let server: any;

export async function setupTestServer() {
  try {
    // Create Express app with basic setup
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Basic health check endpoints for testing
    app.get('/healthz', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/readyz', (req, res) => {
      res.json({
        status: 'ready',
        checks: {
          database: 'ok',
          redis: 'ok'
        },
        timestamp: new Date().toISOString()
      });
    });

    // Mock translation endpoint
    app.post('/api/translate', (req, res) => {
      const { text, sourceLang, targetLang } = req.body;

      if (!text || !targetLang) {
        return res.status(400).json({
          error: 'Missing required fields: text, targetLang'
        });
      }

      if (text.trim() === '') {
        return res.status(400).json({
          error: 'Text cannot be empty'
        });
      }

      // Simple mock translation logic
      const translations: Record<string, Record<string, string>> = {
        en: {
          lt: 'Lietuviškas vertimas',
          es: 'Traducción al español'
        },
        lt: {
          en: 'English translation'
        }
      };

      const detectedSourceLang = sourceLang || detectLanguage(text);
      const translatedText = translations[detectedSourceLang]?.[targetLang] || `Mock translation of "${text}" to ${targetLang}`;

      res.json({
        translatedText,
        sourceLang: detectedSourceLang,
        targetLang,
        confidence: 0.95,
        detectedSourceLang: sourceLang ? undefined : detectedSourceLang,
        timestamp: new Date().toISOString()
      });
    });

    return app;
  } catch (error) {
    console.error('Failed to setup test server:', error);
    throw error;
  }
}

function detectLanguage(text: string): string {
  // Improved language detection mock
  const lithuanian = /[ąčęėįšųūž]|labas|rytas|vakaras|diena|naktis|gerai|blogai/i;
  const russian = /[а-яё]|привет|добр|утро|день|вечер|ночь/i;

  if (lithuanian.test(text)) return 'lt';
  if (russian.test(text)) return 'ru';
  return 'en'; // Default to English
}

export function getTestApp() {
  return app;
}

export async function closeTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function testRequest() {
  return request(app);
}

// Helper to create authenticated request
export async function authenticatedRequest(userId: string = 'test-user') {
  const token = generateTestToken(userId);
  return request(app).set('Authorization', `Bearer ${token}`);
}

function generateTestToken(userId: string) {
  // Generate test JWT token
  return jwt.sign(
    { userId, role: 'user' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

// Rate limiting helper
let requestCounts: Record<string, number> = {};

export function simulateRateLimit(ip: string = '127.0.0.1'): boolean {
  const now = Date.now();
  const key = `${ip}-${Math.floor(now / 60000)}`; // Per minute

  if (!requestCounts[key]) {
    requestCounts[key] = 0;
  }

  requestCounts[key]++;
  return requestCounts[key] > 5; // Limit to 5 requests per minute
}