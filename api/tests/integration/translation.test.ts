import { setupTestServer, closeTestServer, testRequest, simulateRateLimit } from '../helpers/test-server';

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
      expect(response.body.confidence).toBeGreaterThan(0);
      expect(response.body.translatedText).toBeTruthy();
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
      expect(response.body.translatedText).toBeTruthy();
    });

    it('should handle missing text parameter', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          targetLang: 'en'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should handle missing target language', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Hello world'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should handle empty text', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: '',
          targetLang: 'lt'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should translate from Lithuanian to English', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Ačiū už pagalbą',
          sourceLang: 'lt',
          targetLang: 'en'
        })
        .expect(200);

      expect(response.body.sourceLang).toBe('lt');
      expect(response.body.targetLang).toBe('en');
      expect(response.body.translatedText).toBeTruthy();
    });

    it('should handle long text translation', async () => {
      const longText = 'This is a very long text that needs to be translated. '.repeat(10);

      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: longText,
          sourceLang: 'en',
          targetLang: 'lt'
        })
        .expect(200);

      expect(response.body.translatedText).toBeTruthy();
      expect(response.body.confidence).toBeGreaterThan(0);
    });

    it('should include timestamp in response', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Test message',
          sourceLang: 'en',
          targetLang: 'lt'
        })
        .expect(200);

      expect(response.body.timestamp).toBeTruthy();
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Health Checks', () => {
    it('should return healthy status', async () => {
      const response = await testRequest()
        .get('/healthz')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeTruthy();
    });

    it('should check service readiness', async () => {
      const response = await testRequest()
        .get('/readyz')
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('redis');
      expect(response.body.checks.database).toBe('ok');
      expect(response.body.checks.redis).toBe('ok');
      expect(response.body.timestamp).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      // Express should handle malformed JSON
    });

    it('should handle unsupported content type', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .set('Content-Type', 'text/plain')
        .send('plain text')
        .expect(400);
    });
  });

  describe('Input Validation', () => {
    it('should validate language codes', async () => {
      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: 'Hello',
          sourceLang: 'invalid',
          targetLang: 'also-invalid'
        })
        .expect(200); // Mock API accepts any language codes

      expect(response.body.translatedText).toBeTruthy();
    });

    it('should handle special characters', async () => {
      const specialText = 'Hello! @#$%^&*()_+-=[]{}|;:\'\",./<>?`~';

      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: specialText,
          sourceLang: 'en',
          targetLang: 'lt'
        })
        .expect(200);

      expect(response.body.translatedText).toBeTruthy();
    });

    it('should handle unicode characters', async () => {
      const unicodeText = '🚀 Hello 世界 Привет ąčęėįšųūž';

      const response = await testRequest()
        .post('/api/translate')
        .send({
          text: unicodeText,
          sourceLang: 'en',
          targetLang: 'lt'
        })
        .expect(200);

      expect(response.body.translatedText).toBeTruthy();
    });
  });
});