import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
export interface ChannelConfig {
    roomId: string;
    enabled: boolean;
    defaultSourceLanguage?: string;
    defaultTargetLanguage?: string;
    allowedLanguages?: string[];
    blockedLanguages?: string[];
    provider?: string;
    context?: string;
    glossary?: Map<string, string>;
    autoDetectLanguage: boolean;
    showTranslationIndicator: boolean;
    allowUserOverride: boolean;
    moderatorOnly: boolean;
    translationMode: 'all' | 'selective' | 'prefix';
    costTracking: boolean;
    monthlyBudget?: number;
    currentMonthUsage?: number;
}
export interface ChannelStats {
    roomId: string;
    totalTranslations: number;
    languagePairs: Map<string, number>;
    topUsers: Array<{
        userId: string;
        count: number;
    }>;
    averageResponseTime: number;
    cacheHitRate: number;
    monthlyUsage: number;
    estimatedCost: number;
}
export declare class ChannelConfigService {
    private readonly CONFIG_KEY;
    getChannelConfig(roomId: string, read: IRead, _persistence: IPersistence): Promise<ChannelConfig | null>;
    setChannelConfig(roomId: string, config: Partial<ChannelConfig>, read: IRead, persistence: IPersistence): Promise<boolean>;
    enableChannel(roomId: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    disableChannel(roomId: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    setChannelLanguages(roomId: string, sourceLanguage: string, targetLanguage: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    addAllowedLanguage(roomId: string, language: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    addGlossaryTerm(roomId: string, original: string, translation: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    updateChannelStats(roomId: string, stats: Partial<ChannelStats>, read: IRead, persistence: IPersistence): Promise<boolean>;
    getChannelStats(roomId: string, read: IRead, _persistence: IPersistence): Promise<ChannelStats>;
    incrementTranslationCount(roomId: string, sourceLanguage: string, targetLanguage: string, userId: string, read: IRead, persistence: IPersistence): Promise<boolean>;
    updateMonthlyUsage(roomId: string, cost: number, read: IRead, persistence: IPersistence): Promise<boolean>;
    private getChannelConfigRaw;
    private getDefaultConfig;
    private getDefaultStats;
    private serializeConfig;
    private deserializeConfig;
    private deserializeStats;
}
//# sourceMappingURL=ChannelConfigService.d.ts.map