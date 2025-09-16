export interface User {
    id: string;
    username: string;
    email?: string;
    preferences?: UserPreferences;
    subscription?: UserSubscription;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserPreferences {
    targetLanguage: string;
    sourceLanguage?: string;
    autoTranslate: boolean;
    showOriginalOnHover: boolean;
    enablePrefixDetection: boolean;
    notifyOnTranslation: boolean;
    theme?: 'light' | 'dark' | 'auto';
}

export interface UserSubscription {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    startDate: Date;
    endDate?: Date;
    monthlyQuota?: number;
    usedQuota?: number;
    customerId?: string;
}

export type SubscriptionPlan = 
    | 'free'
    | 'starter'
    | 'professional'
    | 'enterprise'
    | 'custom';

export type SubscriptionStatus = 
    | 'active'
    | 'paused'
    | 'cancelled'
    | 'expired'
    | 'trial';

export interface UserStats {
    userId: string;
    totalTranslations: number;
    totalCharacters: number;
    languagePairs: Record<string, number>;
    providers: Record<string, number>;
    lastTranslation?: Date;
    averageResponseTime?: number;
}