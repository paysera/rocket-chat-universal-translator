export interface TranslationRequest {
    text: string;
    sourceLanguage?: string;
    targetLanguage: string;
    provider?: TranslationProvider;
    context?: string;
    preserveFormatting?: boolean;
    glossary?: Record<string, string>;
}

export interface TranslationResponse {
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    provider: TranslationProvider;
    confidence?: number;
    alternatives?: string[];
    usage?: TranslationUsage;
    cached?: boolean;
}

export interface BatchTranslationRequest {
    messages: Array<{
        id: string;
        text: string;
    }>;
    sourceLanguage?: string;
    targetLanguage: string;
    provider?: TranslationProvider;
    context?: string;
}

export interface BatchTranslationResponse {
    translations: Array<{
        id: string;
        translatedText: string;
        sourceLanguage: string;
        cached?: boolean;
    }>;
    provider: TranslationProvider;
    usage?: TranslationUsage;
}

export interface LanguageDetectionRequest {
    text: string;
    hints?: string[];
}

export interface LanguageDetectionResponse {
    language: string;
    confidence: number;
    alternatives?: Array<{
        language: string;
        confidence: number;
    }>;
}

export type TranslationProvider = 
    | 'auto'
    | 'claude'
    | 'openai'
    | 'deepl'
    | 'google'
    | 'azure'
    | 'anthropic';

export interface TranslationUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cost?: number;
    processingTime?: number;
}

export interface TranslationError {
    code: string;
    message: string;
    provider?: TranslationProvider;
    retryable?: boolean;
    details?: any;
}

export const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'it', name: 'Italian' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'pl', name: 'Polish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'tr', name: 'Turkish' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'da', name: 'Danish' },
    { code: 'fi', name: 'Finnish' },
    { code: 'cs', name: 'Czech' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'ro', name: 'Romanian' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'el', name: 'Greek' },
    { code: 'he', name: 'Hebrew' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
] as const;

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGES[number]['code'];