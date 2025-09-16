import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { translationRateLimiter } from '../middleware/rateLimiter';
import { asyncHandler } from '../middleware/errorHandler';
import { pool } from '../config/database';
import { redis, cache, getTranslationCacheKey } from '../config/redis';
import { log } from '../utils/logger';
import crypto from 'crypto';

const router = Router();

// Translation request interface
interface TranslationRequest {
  text: string;
  targetLang: string;
  sourceLang?: string;
  context?: string[];
  provider?: string;
  quality?: 'fast' | 'balanced' | 'quality';
  channelId?: string;
  messageId?: string;
}

// Translation response interface
interface TranslationResponse {
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  model?: string;
  confidence?: number;
  cached: boolean;
  cost?: number;
  processingTime: number;
}

// Validation rules
const translateValidation = [
  body('text')
    .notEmpty().withMessage('Text is required')
    .isLength({ max: 10000 }).withMessage('Text must be less than 10000 characters'),
  body('targetLang')
    .notEmpty().withMessage('Target language is required')
    .isLength({ min: 2, max: 10 }).withMessage('Invalid language code'),
  body('sourceLang')
    .optional()
    .isLength({ min: 2, max: 10 }).withMessage('Invalid language code'),
  body('context')
    .optional()
    .isArray().withMessage('Context must be an array')
    .custom((value) => value.length <= 10).withMessage('Maximum 10 context messages allowed'),
  body('provider')
    .optional()
    .isIn(['openai', 'claude', 'deepl', 'google']).withMessage('Invalid provider'),
  body('quality')
    .optional()
    .isIn(['fast', 'balanced', 'quality']).withMessage('Invalid quality tier'),
];

// Main translation endpoint
router.post(
  '/translate',
  authenticateToken,
  translationRateLimiter,
  translateValidation,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const startTime = Date.now();
    
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    
    const {
      text,
      targetLang,
      sourceLang = 'auto',
      context = [],
      provider,
      quality = 'balanced',
      channelId,
      messageId,
    }: TranslationRequest = req.body;
    
    const { userId, workspaceId } = req.user!;
    
    // Check user preferences
    const userPrefs = await getUserPreferences(userId, workspaceId);
    
    if (!userPrefs.enabled) {
      return res.status(403).json({
        error: 'Translation disabled',
        message: 'Translation is disabled for your account',
      });
    }
    
    // Check subscription limits
    const canTranslate = await checkUsageLimit(workspaceId, text.length);
    if (!canTranslate) {
      return res.status(429).json({
        error: 'Usage limit exceeded',
        message: 'You have exceeded your translation limit',
      });
    }
    
    // Generate cache key
    const cacheKey = getTranslationCacheKey(text, sourceLang, targetLang, provider);
    
    // Check cache first
    const cachedTranslation = await checkCache(cacheKey);
    if (cachedTranslation) {
      log.translation('cache_hit', {
        userId,
        workspaceId,
        cacheKey,
        sourceLang,
        targetLang,
      });
      
      return res.json({
        ...cachedTranslation,
        cached: true,
        processingTime: Date.now() - startTime,
      });
    }
    
    // Perform translation (placeholder for now)
    const translation = await performTranslation({
      text,
      sourceLang,
      targetLang,
      context,
      provider: provider || selectProvider(quality),
      quality,
    });
    
    // Cache the translation
    await cacheTranslation(cacheKey, translation);
    
    // Track usage
    await trackUsage({
      workspaceId,
      userId,
      channelId,
      messageId,
      characters: text.length,
      provider: translation.provider,
      model: translation.model,
      cost: translation.cost,
      responseTime: Date.now() - startTime,
      cacheHit: false,
    });
    
    // Log translation event
    log.translation('translation_completed', {
      userId,
      workspaceId,
      sourceLang: translation.sourceLang,
      targetLang: translation.targetLang,
      provider: translation.provider,
      characters: text.length,
      processingTime: Date.now() - startTime,
    });
    
    res.json({
      ...translation,
      cached: false,
      processingTime: Date.now() - startTime,
    });
  })
);

// Batch translation endpoint
router.post(
  '/translate/batch',
  authenticateToken,
  translationRateLimiter,
  [
    body('texts')
      .isArray().withMessage('Texts must be an array')
      .custom((value) => value.length <= 50).withMessage('Maximum 50 texts allowed'),
    body('texts.*')
      .notEmpty().withMessage('Text cannot be empty')
      .isLength({ max: 5000 }).withMessage('Each text must be less than 5000 characters'),
    ...translateValidation.slice(1), // Reuse other validation rules
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const startTime = Date.now();
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    
    const { texts, targetLang, sourceLang = 'auto', provider, quality = 'balanced' } = req.body;
    const { userId, workspaceId } = req.user!;
    
    // Check total character count
    const totalChars = texts.reduce((sum: number, text: string) => sum + text.length, 0);
    
    const canTranslate = await checkUsageLimit(workspaceId, totalChars);
    if (!canTranslate) {
      return res.status(429).json({
        error: 'Usage limit exceeded',
        message: 'Batch translation exceeds your usage limit',
      });
    }
    
    // Process translations in parallel
    const translations = await Promise.all(
      texts.map(async (text: string) => {
        const cacheKey = getTranslationCacheKey(text, sourceLang, targetLang, provider);
        const cached = await checkCache(cacheKey);
        
        if (cached) {
          return { ...cached, cached: true };
        }
        
        const translation = await performTranslation({
          text,
          sourceLang,
          targetLang,
          provider: provider || selectProvider(quality),
          quality,
        });
        
        await cacheTranslation(cacheKey, translation);
        return { ...translation, cached: false };
      })
    );
    
    // Track batch usage
    await trackUsage({
      workspaceId,
      userId,
      characters: totalChars,
      provider: translations[0].provider,
      cost: translations.reduce((sum, t) => sum + (t.cost || 0), 0),
      responseTime: Date.now() - startTime,
      cacheHit: false,
    });
    
    res.json({
      translations,
      totalCharacters: totalChars,
      processingTime: Date.now() - startTime,
    });
  })
);

// Language detection endpoint
router.post(
  '/detect',
  authenticateToken,
  [
    body('text')
      .notEmpty().withMessage('Text is required')
      .isLength({ max: 1000 }).withMessage('Text must be less than 1000 characters'),
  ],
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    
    const { text } = req.body;
    
    // Detect language (placeholder implementation)
    const detectedLang = await detectLanguage(text);
    
    res.json({
      language: detectedLang.language,
      confidence: detectedLang.confidence,
      alternatives: detectedLang.alternatives,
    });
  })
);

// Get supported languages
router.get('/languages', async (req: Request, res: Response) => {
  const languages = await getSupportedLanguages();
  res.json(languages);
});

// Helper functions

async function getUserPreferences(userId: string, workspaceId: string) {
  const cacheKey = `user:${workspaceId}:${userId}:preferences`;
  
  // Check cache first
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Query database
  const result = await pool.query(
    `SELECT * FROM user_preferences 
     WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId]
  );
  
  const preferences = result.rows[0] || {
    enabled: true,
    source_language: 'auto',
    target_language: 'en',
    quality_tier: 'balanced',
  };
  
  // Cache for 5 minutes
  await cache.set(cacheKey, preferences, 300);
  
  return preferences;
}

async function checkUsageLimit(workspaceId: string, characters: number): Promise<boolean> {
  const result = await pool.query(
    'SELECT check_usage_limit($1, $2) as allowed',
    [workspaceId, characters * 0.0001] // Rough cost estimate
  );
  
  return result.rows[0].allowed;
}

async function checkCache(cacheKey: string): Promise<TranslationResponse | null> {
  try {
    // Check Redis first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Check database cache
    const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
    const result = await pool.query(
      `UPDATE translation_cache 
       SET hits = hits + 1, last_accessed = CURRENT_TIMESTAMP 
       WHERE hash = $1 
       RETURNING *`,
      [hash]
    );
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const translation = {
        translatedText: row.translated_text,
        sourceLang: row.source_lang,
        targetLang: row.target_lang,
        provider: row.provider,
        model: row.model,
        confidence: parseFloat(row.confidence),
        cached: true,
        cost: parseFloat(row.cost),
        processingTime: 0,
      };
      
      // Store in Redis for faster access
      await cache.set(cacheKey, translation, 3600);
      
      return translation;
    }
  } catch (error) {
    log.error('Cache check error', error);
  }
  
  return null;
}

async function cacheTranslation(cacheKey: string, translation: TranslationResponse) {
  try {
    // Store in Redis
    await cache.set(cacheKey, translation, 3600);
    
    // Store in database
    const hash = crypto.createHash('sha256').update(cacheKey).digest('hex');
    await pool.query(
      `INSERT INTO translation_cache 
       (hash, source_text, translated_text, source_lang, target_lang, provider, model, confidence, cost) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       ON CONFLICT (hash) DO NOTHING`,
      [
        hash,
        '', // Source text should be passed separately
        translation.translatedText,
        translation.sourceLang,
        translation.targetLang,
        translation.provider,
        translation.model,
        translation.confidence,
        translation.cost,
      ]
    );
  } catch (error) {
    log.error('Cache storage error', error);
  }
}

async function trackUsage(data: any) {
  try {
    await pool.query(
      `INSERT INTO usage_tracking 
       (workspace_id, user_id, channel_id, message_id, characters, provider, model, cost_amount, response_time_ms, cache_hit) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        data.workspaceId,
        data.userId,
        data.channelId,
        data.messageId,
        data.characters,
        data.provider,
        data.model,
        data.cost,
        data.responseTime,
        data.cacheHit,
      ]
    );
    
    // Update workspace usage if not cached
    if (!data.cacheHit && data.cost) {
      await pool.query(
        'SELECT update_usage($1, $2)',
        [data.workspaceId, data.cost]
      );
    }
  } catch (error) {
    log.error('Usage tracking error', error);
  }
}

// Placeholder translation function
async function performTranslation(params: any): Promise<TranslationResponse> {
  // This is a placeholder - actual implementation will integrate with AI providers
  return {
    translatedText: `[Translated: ${params.text}]`,
    sourceLang: params.sourceLang === 'auto' ? 'en' : params.sourceLang,
    targetLang: params.targetLang,
    provider: params.provider || 'mock',
    model: 'mock-model',
    confidence: 0.95,
    cached: false,
    cost: 0.0001,
    processingTime: 100,
  };
}

// Placeholder language detection
async function detectLanguage(text: string) {
  return {
    language: 'en',
    confidence: 0.98,
    alternatives: [
      { language: 'es', confidence: 0.15 },
      { language: 'fr', confidence: 0.10 },
    ],
  };
}

// Placeholder provider selection
function selectProvider(quality: string): string {
  switch (quality) {
    case 'fast':
      return 'google';
    case 'quality':
      return 'claude';
    default:
      return 'openai';
  }
}

// Get supported languages
async function getSupportedLanguages() {
  return {
    languages: [
      { code: 'en', name: 'English', nativeName: 'English' },
      { code: 'es', name: 'Spanish', nativeName: 'Español' },
      { code: 'fr', name: 'French', nativeName: 'Français' },
      { code: 'de', name: 'German', nativeName: 'Deutsch' },
      { code: 'it', name: 'Italian', nativeName: 'Italiano' },
      { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
      { code: 'ru', name: 'Russian', nativeName: 'Русский' },
      { code: 'zh', name: 'Chinese', nativeName: '中文' },
      { code: 'ja', name: 'Japanese', nativeName: '日本語' },
      { code: 'ko', name: 'Korean', nativeName: '한국어' },
      { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
      { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių' },
    ],
  };
}

export default router;