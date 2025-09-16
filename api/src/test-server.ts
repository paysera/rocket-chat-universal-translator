import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Simple health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      api: true,
      message: 'Universal Translator API is running'
    }
  });
});

// Test translation endpoint
app.post('/api/v1/translate', (req, res) => {
  const { text, targetLang } = req.body;
  
  if (!text || !targetLang) {
    return res.status(400).json({
      error: 'Missing required fields: text and targetLang'
    });
  }
  
  res.json({
    translatedText: `[Mock translation to ${targetLang}]: ${text}`,
    sourceLang: 'auto',
    targetLang,
    provider: 'mock',
    cached: false,
    processingTime: 100
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Universal Translator API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/v1/health`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;