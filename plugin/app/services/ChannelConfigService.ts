import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

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
    topUsers: Array<{ userId: string; count: number }>;
    averageResponseTime: number;
    cacheHitRate: number;
    monthlyUsage: number;
    estimatedCost: number;
}

export class ChannelConfigService {
    private readonly CONFIG_KEY = 'channel_config';

    public async getChannelConfig(roomId: string, read: IRead, _persistence: IPersistence): Promise<ChannelConfig | null> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.ROOM,
                roomId
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                const config = result.find((item: any) => item.id === this.CONFIG_KEY);
                if (config) {
                    return this.deserializeConfig((config as any).data);
                }
            }

            return this.getDefaultConfig(roomId);
        } catch (error) {
            console.error('Error reading channel config:', error);
            return this.getDefaultConfig(roomId);
        }
    }

    public async setChannelConfig(
        roomId: string,
        config: Partial<ChannelConfig>,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.ROOM,
                roomId
            );

            const currentConfig = await this.getChannelConfigRaw(roomId, read, persistence) || this.getDefaultConfig(roomId);
            const updatedConfig = { ...currentConfig, ...config };

            await persistence.updateByAssociation(
                association,
                this.serializeConfig(updatedConfig),
                true
            );

            return true;
        } catch (error) {
            console.error('Error saving channel config:', error);
            return false;
        }
    }

    public async enableChannel(roomId: string, read: IRead, persistence: IPersistence): Promise<boolean> {
        return this.setChannelConfig(roomId, { enabled: true }, read, persistence);
    }

    public async disableChannel(roomId: string, read: IRead, persistence: IPersistence): Promise<boolean> {
        return this.setChannelConfig(roomId, { enabled: false }, read, persistence);
    }

    public async setChannelLanguages(
        roomId: string,
        sourceLanguage: string,
        targetLanguage: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        return this.setChannelConfig(roomId, {
            defaultSourceLanguage: sourceLanguage,
            defaultTargetLanguage: targetLanguage,
        }, read, persistence);
    }

    public async addAllowedLanguage(
        roomId: string,
        language: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const config = await this.getChannelConfigRaw(roomId, read, persistence);
            if (!config) {
                return false;
            }

            if (!config.allowedLanguages) {
                config.allowedLanguages = [];
            }

            if (!config.allowedLanguages.includes(language)) {
                config.allowedLanguages.push(language);
                return this.setChannelConfig(roomId, config, read, persistence);
            }

            return true;
        } catch (error) {
            console.error('Error adding allowed language:', error);
            return false;
        }
    }

    public async addGlossaryTerm(
        roomId: string,
        original: string,
        translation: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const config = await this.getChannelConfigRaw(roomId, read, persistence);
            if (!config) {
                return false;
            }

            if (!config.glossary) {
                config.glossary = new Map();
            }

            config.glossary.set(original, translation);
            return this.setChannelConfig(roomId, config, read, persistence);
        } catch (error) {
            console.error('Error adding glossary term:', error);
            return false;
        }
    }

    public async updateChannelStats(
        roomId: string,
        stats: Partial<ChannelStats>,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.ROOM,
                `${roomId}_stats`
            );

            const currentStats = await this.getChannelStats(roomId, read, persistence);
            const updatedStats = { ...currentStats, ...stats };

            await persistence.updateByAssociation(
                association,
                updatedStats,
                true
            );

            return true;
        } catch (error) {
            console.error('Error updating channel stats:', error);
            return false;
        }
    }

    public async getChannelStats(roomId: string, read: IRead, _persistence: IPersistence): Promise<ChannelStats> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.ROOM,
                `${roomId}_stats`
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                return this.deserializeStats(result[0]);
            }

            return this.getDefaultStats(roomId);
        } catch (error) {
            console.error('Error reading channel stats:', error);
            return this.getDefaultStats(roomId);
        }
    }

    public async incrementTranslationCount(
        roomId: string,
        sourceLanguage: string,
        targetLanguage: string,
        userId: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const stats = await this.getChannelStats(roomId, read, persistence);
            
            stats.totalTranslations++;
            
            const languagePair = `${sourceLanguage}-${targetLanguage}`;
            const currentCount = stats.languagePairs.get(languagePair) || 0;
            stats.languagePairs.set(languagePair, currentCount + 1);
            
            const userIndex = stats.topUsers.findIndex(u => u.userId === userId);
            if (userIndex >= 0) {
                stats.topUsers[userIndex].count++;
            } else {
                stats.topUsers.push({ userId, count: 1 });
            }
            
            stats.topUsers.sort((a, b) => b.count - a.count);
            if (stats.topUsers.length > 10) {
                stats.topUsers = stats.topUsers.slice(0, 10);
            }

            return this.updateChannelStats(roomId, stats, read, persistence);
        } catch (error) {
            console.error('Error incrementing translation count:', error);
            return false;
        }
    }

    public async updateMonthlyUsage(
        roomId: string,
        cost: number,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const config = await this.getChannelConfigRaw(roomId, read, persistence);
            if (!config) {
                return false;
            }

            const currentMonth = new Date().getMonth();
            const storedMonth = config.currentMonthUsage ? new Date(config.currentMonthUsage).getMonth() : -1;

            if (currentMonth !== storedMonth) {
                config.currentMonthUsage = cost;
            } else {
                config.currentMonthUsage = (config.currentMonthUsage || 0) + cost;
            }

            return this.setChannelConfig(roomId, config, read, persistence);
        } catch (error) {
            console.error('Error updating monthly usage:', error);
            return false;
        }
    }

    private async getChannelConfigRaw(roomId: string, read: IRead, _persistence: IPersistence): Promise<ChannelConfig | null> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.ROOM,
                roomId
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                return this.deserializeConfig(result[0]);
            }

            return null;
        } catch (error) {
            console.error('Error reading raw channel config:', error);
            return null;
        }
    }

    private getDefaultConfig(roomId: string): ChannelConfig {
        return {
            roomId,
            enabled: false,
            autoDetectLanguage: true,
            showTranslationIndicator: true,
            allowUserOverride: true,
            moderatorOnly: false,
            translationMode: 'all',
            costTracking: true,
            glossary: new Map(),
        };
    }

    private getDefaultStats(roomId: string): ChannelStats {
        return {
            roomId,
            totalTranslations: 0,
            languagePairs: new Map(),
            topUsers: [],
            averageResponseTime: 0,
            cacheHitRate: 0,
            monthlyUsage: 0,
            estimatedCost: 0,
        };
    }

    private serializeConfig(config: ChannelConfig): any {
        return {
            ...config,
            glossary: config.glossary ? Array.from(config.glossary.entries()) : [],
        };
    }

    private deserializeConfig(data: any): ChannelConfig {
        return {
            ...data,
            glossary: data.glossary ? new Map(data.glossary) : new Map(),
        };
    }

    private deserializeStats(data: any): ChannelStats {
        return {
            ...data,
            languagePairs: data.languagePairs ? new Map(data.languagePairs) : new Map(),
        };
    }
}