import dotenv from 'dotenv';
import path from 'path';

// Load test environment
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Mock external services
jest.mock('../src/providers/OpenAIProvider', () => ({
  OpenAIProvider: {
    translate: jest.fn().mockResolvedValue({
      translatedText: 'Mocked translation',
      confidence: 0.95,
      detectedSourceLang: 'en'
    })
  }
}));

jest.mock('../src/providers/ClaudeProvider', () => ({
  ClaudeProvider: {
    translate: jest.fn().mockResolvedValue({
      translatedText: 'Mocked Claude translation',
      confidence: 0.96,
      detectedSourceLang: 'en'
    })
  }
}));


// Set test timeout
jest.setTimeout(30000);

// Suppress console.log in tests unless LOG_LEVEL=debug
if (process.env.LOG_LEVEL !== 'debug') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  };
}