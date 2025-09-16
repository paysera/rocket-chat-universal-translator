import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, TranslationRequest, TranslationResponse } from './base';
import { BaseTranslationProvider, TranslationResult, TranslationOptions } from './base';

export class ClaudeProvider extends BaseProvider {
    private client: Anthropic | null = null;
    private model: string = 'claude-3-opus-20240229';

    constructor() {
        super('claude', {
            supportsContext: true,
            supportsBatch: true,
            supportsGlossary: false,
            maxTextLength: 200000,
            supportedLanguages: [
                'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko',
                'ar', 'hi', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'ms', 'lt'
            ],
            pricing: {
                costPerMillionChars: 30,
                currency: 'USD'
            }
        });
    }

    async initialize(apiKey: string): Promise<void> {
        if (!apiKey) {
            throw new Error('Claude API key is required');
        }
        this.apiKey = apiKey;
        this.client = new Anthropic({ apiKey });
        this.initialized = true;
    }

    async translate(request: TranslationRequest): Promise<TranslationResponse> {
        if (!this.initialized || !this.client) {
            throw new Error('Claude provider not initialized');
        }

        const startTime = Date.now();

        try {
            const systemPrompt = this.buildSystemPrompt(request.sourceLang, request.targetLang, request);
            const userPrompt = this.buildUserPrompt(request.text, request);

            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 4000,
                temperature: 0.3,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: userPrompt }
                ],
            });

            const translatedText = response.content[0].type === 'text' ? response.content[0].text : '';
            const processingTime = Date.now() - startTime;

            return {
                translatedText,
                sourceLang: request.sourceLang,
                targetLang: request.targetLang,
                provider: this.name,
                cached: false,
                processingTime,
                confidence: 0.95,
                cost: this.calculateCost(response.usage),
            };
        } catch (error) {
            console.error('Claude translation error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Translation failed: ${errorMessage}`);
        }
    }

    async checkHealth(): Promise<boolean> {
        if (!this.initialized || !this.client) {
            return false;
        }

        try {
            await this.client.messages.create({
                model: this.model,
                max_tokens: 10,
                temperature: 0,
                system: 'Health check',
                messages: [{ role: 'user', content: 'Test' }],
            });
            return true;
        } catch (error) {
            console.error('Claude health check failed:', error);
            return false;
        }
    }

    private buildSystemPrompt(sourceLang: string, targetLang: string, request: TranslationRequest): string {
        let prompt = `You are an expert translator specializing in ${sourceLang} to ${targetLang} translation.`;

        if (request.context) {
            prompt += ` Context: ${request.context}.`;
        }

        prompt += ` Rules:
        1. Preserve the original meaning and tone
        2. Maintain formatting (line breaks, punctuation, emojis)
        3. Keep technical terms, URLs, and code snippets unchanged
        4. Preserve @mentions and #hashtags
        5. Terms in [[brackets]] should not be translated`;

        return prompt;
    }

    private buildUserPrompt(text: string, request: TranslationRequest): string {
        if (request.context) {
            return `Given the context of "${request.context}", translate the following text:\n\n${text}`;
        }
        return `Translate the following text:\n\n${text}`;
    }

    private calculateCost(usage?: { input_tokens?: number; output_tokens?: number }): number {
        if (!usage) return 0;

        const inputCost = (usage.input_tokens || 0) * 0.000015;
        const outputCost = (usage.output_tokens || 0) * 0.000075;

        return inputCost + outputCost;
    }

    async detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
        if (!this.initialized || !this.client) {
            return { language: 'unknown', confidence: 0 };
        }

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 100,
                temperature: 0,
                system: 'You are a language detection expert. Respond only with the ISO 639-1 language code.',
                messages: [
                    {
                        role: 'user',
                        content: `Detect the language of this text: "${text.substring(0, 500)}"`
                    }
                ],
            });

            const detectedLanguage = response.content[0].type === 'text'
                ? response.content[0].text.trim().toLowerCase()
                : 'unknown';

            return {
                language: detectedLanguage,
                confidence: 0.9,
            };
        } catch (error) {
            console.error('Language detection error:', error);
            return { language: 'unknown', confidence: 0 };
        }
    }
}

// Keep the old class for backward compatibility
export class LegacyClaudeProvider extends BaseTranslationProvider {
    private client: Anthropic;
    private model: string = 'claude-3-opus-20240229';

    constructor(apiKey: string) {
        super('claude', apiKey, 'https://api.anthropic.com');
        this.client = new Anthropic({ apiKey });
    }

    async translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string,
        options?: TranslationOptions
    ): Promise<TranslationResult> {
        const processedText = this.preprocessText(text, options);
        
        const systemPrompt = this.buildSystemPrompt(sourceLanguage, targetLanguage, options);
        const userPrompt = this.buildUserPrompt(processedText, options);

        try {
            const response = await this.retry(async () => {
                return await this.client.messages.create({
                    model: this.model,
                    max_tokens: options?.maxTokens || 4000,
                    temperature: options?.temperature || 0.3,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt }
                    ],
                });
            });

            const translatedText = this.postprocessText(
                response.content[0].type === 'text' ? response.content[0].text : ''
            );

            return {
                translatedText,
                sourceLanguage,
                targetLanguage,
                confidence: 0.95,
                provider: this.name,
                usage: {
                    inputTokens: response.usage?.input_tokens,
                    outputTokens: response.usage?.output_tokens,
                    cost: this.calculateCost(response.usage),
                },
                metadata: {
                    model: this.model,
                    stopReason: response.stop_reason,
                },
            };
        } catch (error) {
            console.error('Claude translation error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Translation failed: ${errorMessage}`);
        }
    }

    async detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 100,
                temperature: 0,
                system: 'You are a language detection expert. Respond only with the ISO 639-1 language code.',
                messages: [
                    { 
                        role: 'user', 
                        content: `Detect the language of this text: "${text.substring(0, 500)}"`
                    }
                ],
            });

            const detectedLanguage = response.content[0].type === 'text' 
                ? response.content[0].text.trim().toLowerCase() 
                : 'unknown';

            return {
                language: detectedLanguage,
                confidence: 0.9,
            };
        } catch (error) {
            console.error('Language detection error:', error);
            return { language: 'unknown', confidence: 0 };
        }
    }

    isLanguagePairSupported(source: string, target: string): boolean {
        const supportedLanguages = [
            'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko',
            'ar', 'hi', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'ms', 'lt',
        ];
        return supportedLanguages.includes(source) && supportedLanguages.includes(target);
    }

    getEstimatedCost(textLength: number): number {
        const tokensEstimate = textLength / 4;
        const inputCostPerToken = 0.000015;
        const outputCostPerToken = 0.000075;
        const outputMultiplier = 1.2;
        
        return (tokensEstimate * inputCostPerToken) + 
               (tokensEstimate * outputMultiplier * outputCostPerToken);
    }

    private buildSystemPrompt(
        sourceLanguage: string,
        targetLanguage: string,
        options?: TranslationOptions
    ): string {
        let prompt = `You are an expert translator specializing in ${sourceLanguage} to ${targetLanguage} translation.`;
        
        if (options?.context) {
            prompt += ` Context: ${options.context}.`;
        }
        
        prompt += ` Rules:
        1. Preserve the original meaning and tone
        2. Maintain formatting (line breaks, punctuation, emojis)
        3. Keep technical terms, URLs, and code snippets unchanged
        4. Preserve @mentions and #hashtags
        5. Terms in [[brackets]] should not be translated`;
        
        if (options?.preserveFormatting) {
            prompt += `\n6. Strictly preserve all formatting including markdown, HTML tags, and whitespace`;
        }
        
        return prompt;
    }

    private buildUserPrompt(text: string, options?: TranslationOptions): string {
        if (options?.context) {
            return `Given the context of "${options.context}", translate the following text:\n\n${text}`;
        }
        return `Translate the following text:\n\n${text}`;
    }

    private calculateCost(usage?: { input_tokens?: number; output_tokens?: number }): number {
        if (!usage) return 0;
        
        const inputCost = (usage.input_tokens || 0) * 0.000015;
        const outputCost = (usage.output_tokens || 0) * 0.000075;
        
        return inputCost + outputCost;
    }
}