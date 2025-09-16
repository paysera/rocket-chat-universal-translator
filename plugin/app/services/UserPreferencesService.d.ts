import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
export interface UserPreferences {
    userId: string;
    targetLanguage: string;
    sourceLanguage?: string;
    autoTranslate: boolean;
    showOriginalOnHover: boolean;
    enablePrefixDetection: boolean;
    notifyOnTranslation: boolean;
    customDictionary?: Map<string, string>;
    blockedLanguages?: string[];
    translationHistory?: TranslationHistoryEntry[];
}
export interface TranslationHistoryEntry {
    timestamp: Date;
    originalText: string;
    translatedText: string;
    sourceLanguage: string;
    targetLanguage: string;
    provider: string;
}
export declare class UserPreferencesService {
    private readonly PREFERENCES_KEY;
    private readonly MAX_HISTORY_ENTRIES;
    getUserPreferences(userId: string, read: IRead, _persistence: IPersistence): Promise<UserPreferences | null>;
    setUserPreferences(userId: string, preferences: Partial<UserPreferences>, read: IRead, persistence: IPersistence): Promise<boolean>;
    updateUserLanguage(userId: string, targetLanguage: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    toggleAutoTranslate(userId: string, enabled: boolean, read: IRead, persistence: IPersistence): Promise<boolean>;
    addToHistory(userId: string, entry: TranslationHistoryEntry, read: IRead, persistence: IPersistence): Promise<boolean>;
    getTranslationHistory(userId: string, read: IRead, _persistence: IPersistence): Promise<TranslationHistoryEntry[]>;
    clearHistory(userId: string, persistence: IPersistence): Promise<boolean>;
    addCustomTranslation(userId: string, original: string, translation: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    blockLanguage(userId: string, language: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    private getUserPreferencesRaw;
    private getDefaultPreferences;
    private serializePreferences;
    private deserializePreferences;
}
//# sourceMappingURL=UserPreferencesService.d.ts.map