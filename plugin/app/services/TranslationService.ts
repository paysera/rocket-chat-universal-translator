import { IHttp, IHttpRequest } from '@rocket.chat/apps-engine/definition/accessors';
import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';

export interface TranslationOptions {
    context?: string;
    provider?: string;
    maxLength?: number;
    preserveFormatting?: boolean;
}

export interface TranslationResult {
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    provider: string;
    confidence: number;
    cached: boolean;
}

export class TranslationService {
    private cache: Map<string, TranslationResult> = new Map();
    private apiEndpoint: string = 'https://translator.noreika.lt';
    private apiKey: string = '';

    constructor(private logger: ILogger) {}

    public setApiCredentials(endpoint: string, apiKey: string): void {
        this.apiEndpoint = endpoint;
        this.apiKey = apiKey;
    }

    public async translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string,
        http: IHttp,
        options: TranslationOptions = {}
    ): Promise<string> {
        try {
            const cacheKey = this.getCacheKey(text, sourceLanguage, targetLanguage, options.provider);
            
            const cached = this.cache.get(cacheKey);
            if (cached) {
                this.logger.debug(`Translation cache hit for: ${cacheKey}`);
                return cached.translatedText;
            }

            const request: IHttpRequest = {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                data: {
                    text,
                    source: sourceLanguage,
                    target: targetLanguage,
                    provider: options.provider || 'auto',
                    context: options.context,
                    preserveFormatting: options.preserveFormatting !== false,
                },
            };

            const response = await http.post(`${this.apiEndpoint}/api/translate`, request);
            
            if (response.statusCode !== 200) {
                throw new Error(`Translation API error: ${response.statusCode}`);
            }

            const result: TranslationResult = {
                translatedText: response.data.translation,
                sourceLanguage: response.data.source || sourceLanguage,
                targetLanguage: response.data.target || targetLanguage,
                provider: response.data.provider || 'unknown',
                confidence: response.data.confidence || 1.0,
                cached: false,
            };

            this.cache.set(cacheKey, result);
            
            setTimeout(() => {
                this.cache.delete(cacheKey);
            }, 3600000);

            return result.translatedText;
        } catch (error) {
            this.logger.error('Translation error:', error);
            return text;
        }
    }

    public async detectLanguage(text: string, http: IHttp): Promise<string> {
        try {
            const request: IHttpRequest = {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                data: {
                    text,
                },
            };

            const response = await http.post(`${this.apiEndpoint}/api/detect`, request);
            
            if (response.statusCode !== 200) {
                throw new Error(`Language detection API error: ${response.statusCode}`);
            }

            return response.data.language || 'en';
        } catch (error) {
            this.logger.error('Language detection error:', error);
            return 'en';
        }
    }

    public async batchTranslate(
        messages: Array<{ text: string; id: string }>,
        sourceLanguage: string,
        targetLanguage: string,
        http: IHttp,
        options: TranslationOptions = {}
    ): Promise<Map<string, string>> {
        try {
            const results = new Map<string, string>();
            
            const uncachedMessages = messages.filter(msg => {
                const cacheKey = this.getCacheKey(msg.text, sourceLanguage, targetLanguage, options.provider);
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    results.set(msg.id, cached.translatedText);
                    return false;
                }
                return true;
            });

            if (uncachedMessages.length === 0) {
                return results;
            }

            const request: IHttpRequest = {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                data: {
                    messages: uncachedMessages.map(msg => msg.text),
                    source: sourceLanguage,
                    target: targetLanguage,
                    provider: options.provider || 'auto',
                    context: options.context,
                },
            };

            const response = await http.post(`${this.apiEndpoint}/api/batch-translate`, request);
            
            if (response.statusCode !== 200) {
                throw new Error(`Batch translation API error: ${response.statusCode}`);
            }

            response.data.translations.forEach((translation: string, index: number) => {
                const msg = uncachedMessages[index];
                results.set(msg.id, translation);
                
                const cacheKey = this.getCacheKey(msg.text, sourceLanguage, targetLanguage, options.provider);
                this.cache.set(cacheKey, {
                    translatedText: translation,
                    sourceLanguage,
                    targetLanguage,
                    provider: response.data.provider || 'unknown',
                    confidence: 1.0,
                    cached: false,
                });
            });

            return results;
        } catch (error) {
            this.logger.error('Batch translation error:', error);
            return new Map();
        }
    }

    private getCacheKey(text: string, source: string, target: string, provider?: string): string {
        return `${source}-${target}-${provider || 'auto'}-${this.hashText(text)}`;
    }

    private hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    public clearCache(): void {
        this.cache.clear();
        this.logger.info('Translation cache cleared');
    }

    public getCacheStats(): { size: number; hits: number; misses: number } {
        return {
            size: this.cache.size,
            hits: 0,
            misses: 0,
        };
    }
}