# UŽDUOTIS #002: Sukonfigūruoti ir paleisti testų infrastruktūrą

## 🔴 PRIORITETAS: KRITINIS
**Terminas**: 1-2 dienos
**Laikas**: ~4-6 valandos
**Blokuoja**: Funkcionalumo validacija, production release

## 📋 Problema

Parašyta 417 eilučių testų, bet jie nevykdomi:
- API testai negali prisijungti prie servisų
- Plugin testai neturi test runner konfigūracijos
- Integration testai reikalauja veikiančių servisų
- "No tests found" klaida vykdant testus

## 🎯 Kodėl tai kritiškai svarbu?

1. **Negalime validuoti funkcionalumo**: Be testų nežinome ar kodas veikia
2. **Regression rizika**: Pakeitimai gali sugadinti esamą funkcionalumą
3. **Quality assurance**: Negalime garantuoti kodo kokybės
4. **CI/CD pipeline**: Automated deployment neįmanomas be testų

## 🔧 Kaip taisyti

### Žingsnis 1: Sukurti test environment konfigūraciją

#### A. Sukurti .env.test failą:
```bash
cd /opt/dev/rocket-chat-universal-translator

cat > .env.test << 'EOF'
# Test Environment Configuration
NODE_ENV=test
PORT=3999

# Test Database (atskirta nuo development)
DB_HOST=localhost
DB_PORT=5433
DB_NAME=translator_test
DB_USER=translator
DB_PASSWORD=translator123

# Test Redis
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_PASSWORD=

# Mock Rocket.Chat
ROCKETCHAT_URL=http://localhost:3999/mock-rocketchat
ROCKETCHAT_ADMIN_USER=test_admin
ROCKETCHAT_ADMIN_PASS=test_pass

# Test Security Keys
JWT_SECRET=test-jwt-secret-key
JWT_EXPIRY=1h
ENCRYPTION_KEY=test-encryption-key-32-chars-hex
INTERNAL_SECRET=test-internal-secret

# CORS for tests
ALLOWED_ORIGINS=http://localhost:3999

# Test AI Keys (mock keys)
OPENAI_API_KEY=test-openai-key
ANTHROPIC_API_KEY=test-anthropic-key
DEEPL_API_KEY=test-deepl-key

# Logging
LOG_LEVEL=error
LOG_TO_CONSOLE=false
EOF
```

### Žingsnis 2: Sukurti test database setup script

```bash
cat > api/scripts/setup-test-db.sh << 'EOF'
#!/bin/bash

# Create test database
docker exec -it translator-postgres-dev psql -U translator -c "CREATE DATABASE translator_test;"

# Run migrations on test database
docker exec -it translator-postgres-dev psql -U translator -d translator_test -f /docker-entrypoint-initdb.d/001-initial-schema.sql

echo "Test database created and migrations applied"
EOF

chmod +x api/scripts/setup-test-db.sh
```

### Žingsnis 3: Atnaujinti Jest konfigūraciją

#### A. API test konfigūracija:
```bash
cat > api/jest.config.js << 'EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/migrations/**',
    '!src/**/*.test.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/global-teardown.ts'
};
EOF
```

#### B. Sukurti test setup failus:
```bash
mkdir -p api/tests

cat > api/tests/setup.ts << 'EOF'
import dotenv from 'dotenv';
import path from 'path';

// Load test environment
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Mock external services
jest.mock('../src/providers/OpenAIProvider');
jest.mock('../src/providers/ClaudeProvider');
jest.mock('../src/providers/DeepLProvider');

// Set test timeout
jest.setTimeout(30000);
EOF

cat > api/tests/global-setup.ts << 'EOF'
import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('Setting up test environment...');

  // Start test services
  try {
    execSync('docker-compose -f docker-compose.test.yml up -d', {
      cwd: process.cwd()
    });

    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Setup test database
    execSync('./scripts/setup-test-db.sh', {
      cwd: path.join(process.cwd(), 'api')
    });
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
}
EOF

cat > api/tests/global-teardown.ts << 'EOF'
import { execSync } from 'child_process';

export default async function globalTeardown() {
  console.log('Tearing down test environment...');

  try {
    // Stop test services
    execSync('docker-compose -f docker-compose.test.yml down', {
      cwd: process.cwd()
    });
  } catch (error) {
    console.error('Failed to teardown test environment:', error);
  }
}
EOF
```

### Žingsnis 4: Sukurti docker-compose.test.yml

```bash
cat > docker-compose.test.yml << 'EOF'
version: '3.8'

services:
  postgres-test:
    image: postgres:15-alpine
    container_name: translator-postgres-test
    environment:
      POSTGRES_DB: translator_test
      POSTGRES_USER: translator
      POSTGRES_PASSWORD: translator123
    ports:
      - "5434:5432"
    tmpfs:
      - /var/lib/postgresql/data
    networks:
      - test-network

  redis-test:
    image: redis:7-alpine
    container_name: translator-redis-test
    ports:
      - "6381:6379"
    tmpfs:
      - /data
    networks:
      - test-network

networks:
  test-network:
    driver: bridge
EOF
```

### Žingsnis 5: Sukurti integration test helper

```bash
cat > api/tests/helpers/test-server.ts << 'EOF'
import express from 'express';
import request from 'supertest';
import { createServer } from '../../src/server';

let app: express.Application;
let server: any;

export async function setupTestServer() {
  app = await createServer();
  return app;
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
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { userId, role: 'user' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}
EOF
```

### Žingsnis 6: Atnaujinti package.json test scripts

```bash
# API package.json
cd api
npm pkg set scripts.test="jest --detectOpenHandles --forceExit"
npm pkg set scripts.test:watch="jest --watch"
npm pkg set scripts.test:coverage="jest --coverage"
npm pkg set scripts.test:integration="jest --testPathPattern=integration"
npm pkg set scripts.test:unit="jest --testPathPattern=unit"

# Plugin package.json
cd ../plugin
npm pkg set scripts.test="jest"
npm pkg set scripts.test:watch="jest --watch"
```

### Žingsnis 7: Sukurti pavyzdinį integration testą

```bash
cat > api/tests/integration/translation.test.ts << 'EOF'
import { setupTestServer, closeTestServer, testRequest } from '../helpers/test-server';

describe('Translation API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestServer();
  });

  afterAll(async () => {
    await closeTestServer();
  });

  describe('POST /api/translate', () => {
    it('should translate text successfully', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Hello world',
          sourceLang: 'en',
          targetLang: 'lt'
        })
        .expect(200);

      expect(response.body).toHaveProperty('translatedText');
      expect(response.body).toHaveProperty('confidence');
      expect(response.body.sourceLang).toBe('en');
      expect(response.body.targetLang).toBe('lt');
    });

    it('should auto-detect source language', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Labas rytas',
          targetLang: 'en'
        })
        .expect(200);

      expect(response.body.detectedSourceLang).toBe('lt');
    });

    it('should handle rate limiting', async () => {
      // Send multiple requests
      const promises = Array(10).fill(0).map(() =>
        testRequest()
          .post('/api/translate')
          .send({ text: 'Test', targetLang: 'en' })
      );

      const responses = await Promise.all(promises);
      const rateLimited = responses.some(r => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('Health Checks', () => {
    it('should return healthy status', async () => {
      const response = await testRequest()
        .get('/healthz')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('should check service readiness', async () => {
      const response = await testRequest()
        .get('/readyz')
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('redis');
    });
  });
});
EOF
```

### Žingsnis 8: Paleisti testus

```bash
cd /opt/dev/rocket-chat-universal-translator

# Paleisti test services
docker-compose -f docker-compose.test.yml up -d

# Palaukti kol servisai pasiruoš
sleep 10

# Sukurti test database
./api/scripts/setup-test-db.sh

# Paleisti API testus
cd api
npm test

# Paleisti su coverage
npm run test:coverage

# Paleisti tik integration testus
npm run test:integration

# Paleisti tik unit testus
npm run test:unit
```

## ✅ Sėkmės kriterijai

- [ ] Test environment sukonfigūruotas (.env.test)
- [ ] Test database sukurta ir migracijons pritaikytos
- [ ] Jest konfigūracija veikia
- [ ] Docker test services paleisti
- [ ] Visi 417 eilučių testų vykdomi
- [ ] Coverage report generuojamas
- [ ] CI/CD pipeline gali vykdyti testus

## ⚠️ Galimos problemos

1. **Port konfliktai**: Test services gali konfliktuoti su dev services
   - Sprendimas: Naudoti skirtingus portus (5434, 6381)

2. **Database migrations**: Test DB gali neturėti naujausių migrations
   - Sprendimas: Visada run migrations prieš testus

3. **Mock services**: External API calls turi būti mock'inami
   - Sprendimas: Naudoti jest.mock() arba nock library

4. **Test data cleanup**: Testai gali palikti duomenis
   - Sprendimas: Naudoti beforeEach/afterEach cleanup

## 📚 Papildomi resursai

- [Jest dokumentacija](https://jestjs.io/docs/getting-started)
- [Supertest for API testing](https://github.com/visionmedia/supertest)
- [Docker Compose for testing](https://docs.docker.com/compose/environment-variables/)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Integruoti testus į CI/CD pipeline
2. Pridėti pre-commit hooks test vykdymui
3. Sukonfigūruoti code coverage thresholds
4. Dokumentuoti test strategy README.md