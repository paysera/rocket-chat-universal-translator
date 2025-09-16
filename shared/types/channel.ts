export interface Channel {
    id: string;
    name: string;
    type: ChannelType;
    config?: ChannelConfig;
    stats?: ChannelStats;
    createdAt: Date;
    updatedAt: Date;
}

export interface ChannelConfig {
    enabled: boolean;
    defaultSourceLanguage?: string;
    defaultTargetLanguage?: string;
    allowedLanguages?: string[];
    blockedLanguages?: string[];
    provider?: string;
    context?: string;
    autoDetectLanguage: boolean;
    showTranslationIndicator: boolean;
    allowUserOverride: boolean;
    moderatorOnly: boolean;
    translationMode: TranslationMode;
    costTracking: boolean;
    monthlyBudget?: number;
    glossary?: Record<string, string>;
}

export interface ChannelStats {
    channelId: string;
    totalTranslations: number;
    languagePairs: Record<string, number>;
    topUsers: Array<{
        userId: string;
        count: number;
    }>;
    averageResponseTime: number;
    cacheHitRate: number;
    monthlyUsage: number;
    estimatedCost: number;
    lastTranslation?: Date;
}

export type ChannelType = 
    | 'public'
    | 'private'
    | 'direct'
    | 'group';

export type TranslationMode = 
    | 'all'
    | 'selective'
    | 'prefix'
    | 'manual';

export interface ChannelMember {
    userId: string;
    channelId: string;
    role: MemberRole;
    preferredLanguage?: string;
    autoTranslate: boolean;
    joinedAt: Date;
}

export type MemberRole = 
    | 'owner'
    | 'moderator'
    | 'member'
    | 'guest';