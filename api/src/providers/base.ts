// Legacy aliases for backward compatibility
export interface TranslationResult {
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    confidence: number;
    provider: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cost?: number;
    };
    metadata?: Record<string, any>;
}

export interface TranslationOptions {
    context?: string;
    glossary?: Record<string, string>;
    preserveFormatting?: boolean;
    temperature?: number;
    maxTokens?: number;
}

// New interfaces used by providers
export interface TranslationRequest {
    text: string;
    sourceLang: string;
    targetLang: string;
    quality?: 'standard' | 'quality';
    domain?: 'legal' | 'medical' | 'creative' | 'technical' | 'general';
    context?: Array<{ user: string; text: string }>;
    glossary?: Record<string, string>;
}

export interface TranslationResponse {
    translatedText: string;
    sourceLang: string;
    targetLang: string;
    provider: string;
    cached: boolean;
    processingTime: number;
    cost?: number;
    confidence?: number;
    detectedSourceLang?: string;
}

export interface ProviderCapabilities {
    supportsContext: boolean;
    supportsBatch: boolean;
    supportsGlossary: boolean;
    maxTextLength: number;
    supportedLanguages: string[];
    pricing?: {
        costPerMillionChars?: number;
        currency?: string;
    };
}

// Base provider class
export abstract class BaseProvider {
    public readonly name: string;
    protected apiKey: string = '';
    protected baseUrl: string = '';
    protected initialized: boolean = false;
    protected capabilities: ProviderCapabilities;

    constructor(name: string, capabilities?: Partial<ProviderCapabilities>) {
        this.name = name;
        this.capabilities = {
            supportsContext: false,
            supportsBatch: false,
            supportsGlossary: false,
            maxTextLength: 5000,
            supportedLanguages: [],
            ...capabilities
        };
    }

    abstract initialize(apiKey: string): Promise<void>;
    abstract translate(request: TranslationRequest): Promise<TranslationResponse>;
    abstract checkHealth(): Promise<boolean>;

    async detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
        // Default implementation - can be overridden by providers
        return { language: 'unknown', confidence: 0 };
    }

    isLanguagePairSupported(source: string, target: string): boolean {
        // Default implementation - check if languages are in supported list
        const supported = this.capabilities.supportedLanguages;
        return supported.length === 0 || (supported.includes(source) && supported.includes(target));
    }

    async getHealthStatus(): Promise<boolean> {
        return await this.checkHealth();
    }

    getEstimatedCost(textLength: number): number {
        // Default implementation - can be overridden by providers
        if (this.capabilities.pricing?.costPerMillionChars) {
            return (textLength / 1000000) * this.capabilities.pricing.costPerMillionChars;
        }
        return 0;
    }
    
    isInitialized(): boolean {
        return this.initialized;
    }

    getName(): string {
        return this.name;
    }

    getCapabilities(): ProviderCapabilities {
        return this.capabilities;
    }
}

// Keep the old abstract class for backward compatibility
export abstract class BaseTranslationProvider {
    protected name: string;
    protected apiKey: string;
    protected baseUrl: string;
    protected maxRetries: number = 3;
    protected timeout: number = 30000;

    constructor(name: string, apiKey: string, baseUrl: string) {
        this.name = name;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    abstract translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string,
        options?: TranslationOptions
    ): Promise<TranslationResult>;

    abstract detectLanguage(text: string): Promise<{ language: string; confidence: number }>;

    abstract isLanguagePairSupported(source: string, target: string): boolean;

    abstract getEstimatedCost(textLength: number): number;

    protected async retry<T>(
        fn: () => Promise<T>,
        retries: number = this.maxRetries
    ): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            if (retries > 0) {
                await this.delay(Math.pow(2, this.maxRetries - retries) * 1000);
                return this.retry(fn, retries - 1);
            }
            throw error;
        }
    }

    protected delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    protected preprocessText(text: string, options?: TranslationOptions): string {
        let processedText = text;

        if (options?.glossary) {
            Object.entries(options.glossary).forEach(([term, replacement]) => {
                const regex = new RegExp(`\\b${term}\\b`, 'gi');
                processedText = processedText.replace(regex, `[[${replacement}]]`);
            });
        }

        return processedText;
    }

    protected postprocessText(text: string): string {
        return text.replace(/\[\[(.*?)\]\]/g, '$1');
    }

    getName(): string {
        return this.name;
    }

    getHealthStatus(): Promise<boolean> {
        return Promise.resolve(true);
    }
}