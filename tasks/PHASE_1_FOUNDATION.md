# 📦 Phase 1: Foundation & Setup Tasks
**Duration**: Weeks 1-2  
**Priority**: Critical Path  
**Team**: Full Stack + DevOps

---

## Week 1: Infrastructure Foundation

### Day 1-2: Project Setup & Repository

#### Morning Session Tasks
```bash
# Task 1.1: Initialize Repository
git init
git flow init
git remote add origin [repository-url]

# Task 1.2: Create Project Structure
mkdir -p {api,plugin,shared,tests,docs,tasks,scripts}
mkdir -p api/{src,tests,config}
mkdir -p plugin/{src,tests,ui}
mkdir -p shared/{types,utils,constants}
```

#### Task 1.3: Package Configuration
```json
// package.json setup
{
  "name": "universal-translator-pro",
  "version": "0.1.0",
  "workspaces": ["api", "plugin", "shared"],
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:plugin\"",
    "dev:api": "cd api && npm run dev",
    "dev:plugin": "cd plugin && npm run dev",
    "test": "jest --coverage",
    "lint": "eslint . --ext .ts,.tsx",
    "build": "npm run build:api && npm run build:plugin"
  }
}
```

#### Task 1.4: Docker Environment
```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: translator
      POSTGRES_USER: translator
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  rocketchat:
    image: rocketchat/rocket.chat:6.4.0
    environment:
      ROOT_URL: http://localhost:3000
      MONGO_URL: mongodb://mongo:27017/rocketchat
    ports:
      - "3000:3000"
    depends_on:
      - mongo

  mongo:
    image: mongo:5.0
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
```

#### Task 1.5: CI/CD Pipeline
```yaml
# .github/workflows/ci.yml
name: CI Pipeline
on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

---

### Day 3-4: API Infrastructure

#### Task 1.6: Express Server Setup
```typescript
// api/src/server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Request processing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Custom middleware
app.use(requestLogger);
app.use(rateLimiter);

// Routes (to be added)
app.use('/api/v1', routes);

// Error handling
app.use(errorHandler);

export default app;
```

#### Task 1.7: Database Configuration
```typescript
// api/src/config/database.ts
import { Pool } from 'pg';
import { migrate } from 'postgres-migrations';

export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export async function runMigrations() {
  await migrate({ client: pool }, './migrations');
}
```

#### Task 1.8: Redis Cache Setup
```typescript
// api/src/config/redis.ts
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected');
});
```

#### Task 1.9: Environment Configuration
```bash
# .env.example
NODE_ENV=development
PORT=3001

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=translator
DB_USER=translator
DB_PASSWORD=secure_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Security
JWT_SECRET=your-secret-key
ENCRYPTION_KEY=32-char-encryption-key

# AI Providers (optional for now)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPL_API_KEY=

# Rocket.Chat
ROCKETCHAT_URL=http://localhost:3000
ROCKETCHAT_ADMIN_USER=admin
ROCKETCHAT_ADMIN_PASS=admin123
```

---

### Day 5: Database Schema Implementation

#### Task 1.10: Create Migration Files
```sql
-- migrations/001_create_users_preferences.sql
CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(100),
  workspace_id VARCHAR(50) NOT NULL,
  source_language VARCHAR(10) DEFAULT 'auto',
  target_language VARCHAR(10) NOT NULL DEFAULT 'en',
  quality_tier VARCHAR(20) DEFAULT 'balanced',
  auto_translate BOOLEAN DEFAULT true,
  show_original_hover BOOLEAN DEFAULT true,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_workspace (user_id, workspace_id)
);

-- migrations/002_create_channel_configs.sql
CREATE TABLE IF NOT EXISTS channel_configs (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(50) NOT NULL UNIQUE,
  channel_name VARCHAR(100),
  workspace_id VARCHAR(50) NOT NULL,
  translation_enabled BOOLEAN DEFAULT false,
  allowed_users TEXT[],
  blocked_languages TEXT[],
  max_cost_per_message DECIMAL(10,4),
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channel_workspace (channel_id, workspace_id)
);

-- migrations/003_create_translation_cache.sql
CREATE TABLE IF NOT EXISTS translation_cache (
  id SERIAL PRIMARY KEY,
  hash VARCHAR(64) NOT NULL UNIQUE,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang VARCHAR(10),
  target_lang VARCHAR(10),
  provider VARCHAR(50),
  model VARCHAR(100),
  confidence DECIMAL(5,4),
  cost DECIMAL(10,6),
  hits INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cache_hash (hash),
  INDEX idx_cache_langs (source_lang, target_lang)
);

-- migrations/004_create_usage_tracking.sql
CREATE TABLE IF NOT EXISTS usage_tracking (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50),
  channel_id VARCHAR(50),
  message_id VARCHAR(50),
  characters INTEGER NOT NULL,
  tokens_used INTEGER,
  provider VARCHAR(50),
  model VARCHAR(100),
  cost_amount DECIMAL(10,6),
  cost_currency VARCHAR(3) DEFAULT 'EUR',
  response_time_ms INTEGER,
  cache_hit BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_usage_workspace (workspace_id),
  INDEX idx_usage_user (user_id),
  INDEX idx_usage_date (created_at)
);

-- migrations/005_create_provider_configs.sql
CREATE TABLE IF NOT EXISTS provider_configs (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  provider_id VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT,
  preferences JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, provider_id)
);

-- migrations/006_create_analytics.sql
CREATE TABLE IF NOT EXISTS analytics_daily (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  total_translations INTEGER DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  cache_hits INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  top_language_pairs JSONB,
  provider_breakdown JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, date)
);
```

---

## Week 2: Core Services Implementation

### Day 6-7: Security & Authentication

#### Task 2.1: JWT Authentication
```typescript
// api/src/middleware/auth.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    workspaceId: string;
    role: string;
  };
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = decoded as AuthRequest['user'];
    next();
  });
}
```

#### Task 2.2: API Key Encryption
```typescript
// api/src/utils/encryption.ts
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');

export function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decryptApiKey(encryptedData: string): string {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

#### Task 2.3: Rate Limiting
```typescript
// api/src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';

export const rateLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rate_limit:',
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

export const translationRateLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'translation_limit:',
  }),
  windowMs: 60 * 1000,
  max: 50, // 50 translations per minute per user
  keyGenerator: (req) => req.user?.userId || req.ip,
});
```

---

### Day 8-9: Core API Endpoints

#### Task 2.4: Health Check Endpoint
```typescript
// api/src/routes/health.ts
import { Router } from 'express';
import { pool } from '../config/database';
import { redis } from '../config/redis';

const router = Router();

router.get('/health', async (req, res) => {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      api: true,
      database: false,
      redis: false,
    },
  };

  // Check database
  try {
    await pool.query('SELECT 1');
    checks.services.database = true;
  } catch (error) {
    checks.status = 'degraded';
  }

  // Check Redis
  try {
    await redis.ping();
    checks.services.redis = true;
  } catch (error) {
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(checks);
});

export default router;
```

#### Task 2.5: Translation Endpoint Scaffold
```typescript
// api/src/routes/translate.ts
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { translationRateLimiter } from '../middleware/rateLimiter';
import { TranslationService } from '../services/TranslationService';

const router = Router();
const translationService = new TranslationService();

router.post('/translate', 
  authenticateToken, 
  translationRateLimiter,
  async (req, res) => {
    try {
      const { text, targetLang, sourceLang, context } = req.body;
      
      // Validate input
      if (!text || !targetLang) {
        return res.status(400).json({ 
          error: 'Missing required fields: text and targetLang' 
        });
      }

      const result = await translationService.translate({
        text,
        targetLang,
        sourceLang: sourceLang || 'auto',
        context,
        userId: req.user!.userId,
        workspaceId: req.user!.workspaceId,
      });

      res.json(result);
    } catch (error) {
      console.error('Translation error:', error);
      res.status(500).json({ 
        error: 'Translation failed', 
        message: error.message 
      });
    }
  }
);

export default router;
```

#### Task 2.6: User Preferences Endpoints
```typescript
// api/src/routes/preferences.ts
import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { PreferencesService } from '../services/PreferencesService';

const router = Router();
const preferencesService = new PreferencesService();

// Get user preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const preferences = await preferencesService.getUserPreferences(
      req.user!.userId,
      req.user!.workspaceId
    );
    res.json(preferences);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const updated = await preferencesService.updateUserPreferences(
      req.user!.userId,
      req.user!.workspaceId,
      req.body
    );
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
```

---

### Day 10: Development Tools & Testing Setup

#### Task 2.7: ESLint Configuration
```json
// .eslintrc.json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended"
  ],
  "plugins": ["@typescript-eslint", "prettier"],
  "rules": {
    "prettier/prettier": "error",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

#### Task 2.8: Jest Testing Setup
```typescript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/api/tests', '<rootDir>/plugin/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'api/src/**/*.ts',
    'plugin/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

#### Task 2.9: API Documentation
```yaml
# api/swagger.yml
openapi: 3.0.0
info:
  title: Universal Translator Pro API
  version: 1.0.0
  description: Context-aware translation API for Rocket.Chat

servers:
  - url: https://translator.noreika.lt/api/v1
    description: Production server
  - url: http://localhost:3001/api/v1
    description: Development server

paths:
  /health:
    get:
      summary: Health check
      responses:
        200:
          description: Service is healthy
        503:
          description: Service is degraded

  /translate:
    post:
      summary: Translate text
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - text
                - targetLang
              properties:
                text:
                  type: string
                targetLang:
                  type: string
                sourceLang:
                  type: string
                context:
                  type: string
      responses:
        200:
          description: Translation successful
        400:
          description: Invalid request
        401:
          description: Unauthorized
        429:
          description: Rate limit exceeded
```

#### Task 2.10: Logging System
```typescript
// api/src/utils/logger.ts
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'translator-api' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

export default logger;
```

---

## 📋 Phase 1 Checklist

### Infrastructure ✓
- [ ] Git repository with branching strategy
- [ ] Docker Compose environment
- [ ] CI/CD pipeline configured
- [ ] Project documentation structure

### Database ✓
- [ ] PostgreSQL setup and configured
- [ ] All migration files created
- [ ] Indexes optimized
- [ ] Connection pooling configured

### Cache ✓
- [ ] Redis configured and connected
- [ ] Cache strategies defined
- [ ] TTL values optimized

### API Foundation ✓
- [ ] Express server configured
- [ ] Security middleware implemented
- [ ] Authentication system ready
- [ ] Rate limiting active
- [ ] Core endpoints scaffolded

### Development Tools ✓
- [ ] ESLint and Prettier configured
- [ ] Jest testing framework ready
- [ ] API documentation started
- [ ] Logging system implemented
- [ ] Environment variables documented

---

## 🚀 Ready for Phase 2

With Phase 1 complete, the foundation is ready for:
- AI provider integrations
- Translation engine development
- Rocket.Chat plugin development
- UI component creation
- Advanced feature implementation

---

**Phase Owner**: DevOps + Backend Lead  
**Estimated Completion**: 2 weeks  
**Next Phase**: Core Development (Weeks 3-6)