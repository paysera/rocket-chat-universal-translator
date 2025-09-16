import { IHttp } from '@rocket.chat/apps-engine/definition/accessors';
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
export declare class TranslationService {
    private logger;
    private cache;
    private apiEndpoint;
    private apiKey;
    constructor(logger: ILogger);
    setApiCredentials(endpoint: string, apiKey: string): void;
    translate(text: string, sourceLanguage: string, targetLanguage: string, http: IHttp, options?: TranslationOptions): Promise<string>;
    detectLanguage(text: string, http: IHttp): Promise<string>;
    batchTranslate(messages: Array<{
        text: string;
        id: string;
    }>, sourceLanguage: string, targetLanguage: string, http: IHttp, options?: TranslationOptions): Promise<Map<string, string>>;
    private getCacheKey;
    private hashText;
    clearCache(): void;
    getCacheStats(): {
        size: number;
        hits: number;
        misses: number;
    };
}
//# sourceMappingURL=TranslationService.d.ts.map