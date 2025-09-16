import { Router, Request, Response, NextFunction } from 'express';
import { ProviderSelector, ProviderSelectionCriteria } from '../routing/ProviderSelector';
import { DatabaseService } from '../services/database';
import { CacheService } from '../services/cache';
import logger from '../utils/logger';
import { TranslationValidator } from '../validators/translation';
import '../types/express';

export class TranslationRouter {
    private router: Router;
    private providerSelector: ProviderSelector;
    private validator: TranslationValidator;

    constructor(
        private db: DatabaseService,
        private cache: CacheService
    ) {
        this.router = Router();
        this.providerSelector = new ProviderSelector();
        this.validator = new TranslationValidator();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.post('/single', this.handleSingleTranslation.bind(this));
        this.router.post('/batch', this.handleBatchTranslation.bind(this));
        this.router.post('/detect', this.handleLanguageDetection.bind(this));
        this.router.get('/languages', this.handleSupportedLanguages.bind(this));
        this.router.get('/providers', this.handleProviderStatus.bind(this));
    }

    private async handleSingleTranslation(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // Simple validation - can be enhanced later
            const { text, sourceLanguage, targetLanguage, context, provider: preferredProvider } = req.body;
            if (!text || !targetLanguage) {
                res.status(400).json({ error: 'Text and target language are required' });
                return;
            }
            const userId = req.user?.id;

            // Check cache first
            const cacheKey = this.generateCacheKey(text, sourceLanguage, targetLanguage);
            const cachedTranslation = await this.cache.get(cacheKey);
            
            if (cachedTranslation) {
                logger.debug('Cache hit for translation', { cacheKey });
                res.json({
                    ...cachedTranslation,
                    cached: true,
                });
                return;
            }

            // Select optimal provider
            const criteria: ProviderSelectionCriteria = {
                sourceLanguage: sourceLanguage || 'auto',
                targetLanguage,
                textLength: text.length,
                textComplexity: this.analyzeComplexity(text),
                domain: this.detectDomain(text, context),
                priority: req.body.priority || 'quality',
            };

            const provider = await this.providerSelector.selectProvider(criteria);
            
            // Perform translation
            const startTime = Date.now();
            const result = await provider.translate({
                text,
                sourceLang: sourceLanguage || 'auto',
                targetLang: targetLanguage,
                context: context ? [{ user: 'user', text: context }] : undefined,
                glossary: req.body.glossary,
                domain: req.body.domain,
                quality: req.body.quality || 'standard'
            });
            const duration = Date.now() - startTime;

            // Update provider statistics
            this.providerSelector.updateProviderStats(provider.getName(), {
                averageLatency: duration,
                totalRequests: 1,
                successRate: 1.0,
            });

            // Cache the result
            await this.cache.set(cacheKey, result, 3600);

            // Track usage
            await this.trackUsage({
                userId,
                channelId: req.body.channelId,
                provider: provider.getName(),
                characters: text.length,
                cost: result.cost || 0,
            });

            res.json({
                ...result,
                cached: false,
                duration,
            });

        } catch (error) {
            logger.error('Translation error:', error);
            next(error);
        }
    }

    private async handleBatchTranslation(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { messages, sourceLanguage, targetLanguage, context } = req.body;
            
            if (!Array.isArray(messages) || messages.length === 0) {
                res.status(400).json({ error: 'Messages array is required' });
                return;
            }

            if (messages.length > 100) {
                res.status(400).json({ error: 'Maximum 100 messages per batch' });
                return;
            }

            const results = await Promise.all(
                messages.map(async (message) => {
                    const cacheKey = this.generateCacheKey(message.text, sourceLanguage, targetLanguage);
                    const cached = await this.cache.get(cacheKey);
                    
                    if (cached) {
                        return { id: message.id, ...cached, cached: true };
                    }

                    const criteria: ProviderSelectionCriteria = {
                        sourceLanguage: sourceLanguage || 'auto',
                        targetLanguage,
                        textLength: message.text.length,
                        priority: 'cost',
                    };

                    const provider = await this.providerSelector.selectProvider(criteria);
                    const result = await provider.translate({
                        text: message.text,
                        sourceLang: sourceLanguage || 'auto',
                        targetLang: targetLanguage,
                        context: context ? [{ user: 'user', text: context }] : undefined
                    });

                    await this.cache.set(cacheKey, result, 3600);
                    
                    return { id: message.id, ...result, cached: false };
                })
            );

            res.json({ translations: results });

        } catch (error) {
            logger.error('Batch translation error:', error);
            next(error);
        }
    }

    private async handleLanguageDetection(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { text } = req.body;
            
            if (!text) {
                res.status(400).json({ error: 'Text is required' });
                return;
            }

            // Quick language detection using patterns
            const quickDetection = this.quickDetectLanguage(text);
            if (quickDetection.confidence > 0.9) {
                res.json(quickDetection);
                return;
            }

            // Use AI provider for accurate detection
            const provider = await this.providerSelector.selectProvider({
                sourceLanguage: 'auto',
                targetLanguage: 'en',
                textLength: text.length,
                priority: 'speed',
            });

            const result = await provider.detectLanguage(text);
            res.json(result);

        } catch (error) {
            logger.error('Language detection error:', error);
            next(error);
        }
    }

    private handleSupportedLanguages(req: Request, res: Response): void {
        res.json({
            languages: [
                { code: 'en', name: 'English', native: 'English' },
                { code: 'es', name: 'Spanish', native: 'Español' },
                { code: 'fr', name: 'French', native: 'Français' },
                { code: 'de', name: 'German', native: 'Deutsch' },
                { code: 'pt', name: 'Portuguese', native: 'Português' },
                { code: 'it', name: 'Italian', native: 'Italiano' },
                { code: 'ru', name: 'Russian', native: 'Русский' },
                { code: 'zh', name: 'Chinese', native: '中文' },
                { code: 'ja', name: 'Japanese', native: '日本語' },
                { code: 'ko', name: 'Korean', native: '한국어' },
                { code: 'ar', name: 'Arabic', native: 'العربية' },
                { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
                { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
            ],
        });
    }

    private async handleProviderStatus(req: Request, res: Response): Promise<void> {
        const stats = this.providerSelector.getProviderStats();
        const status = [];

        for (const [name, stat] of stats) {
            status.push({
                provider: name,
                status: stat.successRate > 0.9 ? 'healthy' : 'degraded',
                successRate: stat.successRate,
                averageLatency: stat.averageLatency,
                totalRequests: stat.totalRequests,
            });
        }

        res.json({ providers: status });
    }

    private generateCacheKey(text: string, source: string, target: string): string {
        const hash = require('crypto')
            .createHash('sha256')
            .update(`${source}:${target}:${text}`)
            .digest('hex');
        return `translation:${hash}`;
    }

    private analyzeComplexity(text: string): 'simple' | 'moderate' | 'complex' {
        const wordCount = text.split(/\s+/).length;
        const avgWordLength = text.length / wordCount;
        const hasSpecialChars = /[^a-zA-Z0-9\s.,!?]/.test(text);
        
        if (wordCount < 10 && avgWordLength < 6 && !hasSpecialChars) {
            return 'simple';
        }
        if (wordCount > 50 || avgWordLength > 8 || hasSpecialChars) {
            return 'complex';
        }
        return 'moderate';
    }

    private detectDomain(text: string, context?: string): 'general' | 'technical' | 'medical' | 'legal' | 'creative' {
        if (context) {
            if (/medical|health|doctor|patient/i.test(context)) return 'medical';
            if (/legal|law|contract|agreement/i.test(context)) return 'legal';
            if (/code|programming|software|api/i.test(context)) return 'technical';
            if (/creative|story|poem|narrative/i.test(context)) return 'creative';
        }

        if (/function|const|import|export|class|interface/i.test(text)) return 'technical';
        if (/whereas|herein|pursuant|thereof/i.test(text)) return 'legal';
        
        return 'general';
    }

    private quickDetectLanguage(text: string): { language: string; confidence: number } {
        const patterns = {
            en: /\b(the|and|is|are|have|has|with|from|that|this)\b/i,
            es: /\b(el|la|de|que|y|en|un|una|por|para)\b/i,
            fr: /\b(le|la|de|et|est|un|une|pour|dans|que)\b/i,
            de: /\b(der|die|das|und|ist|ein|eine|für|mit|von)\b/i,
            ru: /[а-яА-Я]/,
            zh: /[\u4e00-\u9fa5]/,
            ja: /[\u3040-\u309f\u30a0-\u30ff]/,
            ko: /[\uac00-\ud7af]/,
            ar: /[\u0600-\u06ff]/,
        };

        for (const [lang, pattern] of Object.entries(patterns)) {
            const matches = text.match(pattern);
            if (matches && matches.length > 2) {
                return { language: lang, confidence: 0.95 };
            }
        }

        return { language: 'unknown', confidence: 0 };
    }

    private async trackUsage(data: any): Promise<void> {
        try {
            await this.db.query(
                `INSERT INTO usage_tracking (user_id, channel_id, provider, characters, cost, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [data.userId, data.channelId, data.provider, data.characters, data.cost]
            );
        } catch (error) {
            logger.error('Failed to track usage:', error);
        }
    }

    getRouter(): Router {
        return this.router;
    }
}