import { IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

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

export class UserPreferencesService {
    private readonly PREFERENCES_KEY = 'user_preferences';
    private readonly MAX_HISTORY_ENTRIES = 100;

    public async getUserPreferences(userId: string, read: IRead, _persistence: IPersistence): Promise<UserPreferences | null> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                userId
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                const prefs = result.find((item: any) => item.id === this.PREFERENCES_KEY);
                if (prefs) {
                    return this.deserializePreferences((prefs as any).data);
                }
            }

            return this.getDefaultPreferences(userId);
        } catch (error) {
            console.error('Error reading user preferences:', error);
            return this.getDefaultPreferences(userId);
        }
    }

    public async setUserPreferences(
        userId: string,
        preferences: Partial<UserPreferences>,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                userId
            );

            const currentPrefs = await this.getUserPreferencesRaw(userId, read, persistence) || this.getDefaultPreferences(userId);
            const updatedPrefs = { ...currentPrefs, ...preferences };

            await persistence.updateByAssociation(
                association,
                this.serializePreferences(updatedPrefs),
                true
            );

            return true;
        } catch (error) {
            console.error('Error saving user preferences:', error);
            return false;
        }
    }

    public async updateUserLanguage(
        userId: string,
        targetLanguage: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        return this.setUserPreferences(userId, { targetLanguage }, read, persistence);
    }

    public async toggleAutoTranslate(
        userId: string,
        enabled: boolean,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        return this.setUserPreferences(userId, { autoTranslate: enabled }, read, persistence);
    }

    public async addToHistory(
        userId: string,
        entry: TranslationHistoryEntry,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                `${userId}_history`
            );

            const history = await this.getTranslationHistory(userId, read, persistence);
            history.unshift(entry);

            if (history.length > this.MAX_HISTORY_ENTRIES) {
                history.splice(this.MAX_HISTORY_ENTRIES);
            }

            await persistence.updateByAssociation(
                association,
                history,
                true
            );

            return true;
        } catch (error) {
            console.error('Error adding to translation history:', error);
            return false;
        }
    }

    public async getTranslationHistory(
        userId: string,
        read: IRead,
        _persistence: IPersistence
    ): Promise<TranslationHistoryEntry[]> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                `${userId}_history`
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                return result[0] as TranslationHistoryEntry[];
            }

            return [];
        } catch (error) {
            console.error('Error reading translation history:', error);
            return [];
        }
    }

    public async clearHistory(userId: string, persistence: IPersistence): Promise<boolean> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                `${userId}_history`
            );

            await persistence.removeByAssociation(association);
            return true;
        } catch (error) {
            console.error('Error clearing translation history:', error);
            return false;
        }
    }

    public async addCustomTranslation(
        userId: string,
        original: string,
        translation: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const prefs = await this.getUserPreferencesRaw(userId, read, persistence);
            if (!prefs) {
                return false;
            }

            if (!prefs.customDictionary) {
                prefs.customDictionary = new Map();
            }

            prefs.customDictionary.set(original, translation);
            return this.setUserPreferences(userId, prefs, read, persistence);
        } catch (error) {
            console.error('Error adding custom translation:', error);
            return false;
        }
    }

    public async blockLanguage(
        userId: string,
        language: string,
        read: IRead,
        persistence: IPersistence
    ): Promise<boolean> {
        try {
            const prefs = await this.getUserPreferencesRaw(userId, read, persistence);
            if (!prefs) {
                return false;
            }

            if (!prefs.blockedLanguages) {
                prefs.blockedLanguages = [];
            }

            if (!prefs.blockedLanguages.includes(language)) {
                prefs.blockedLanguages.push(language);
                return this.setUserPreferences(userId, prefs, read, persistence);
            }

            return true;
        } catch (error) {
            console.error('Error blocking language:', error);
            return false;
        }
    }

    private async getUserPreferencesRaw(userId: string, read: IRead, _persistence: IPersistence): Promise<UserPreferences | null> {
        try {
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                userId
            );

            const result = await read.getPersistenceReader().readByAssociation(association);
            
            if (result && result.length > 0) {
                return this.deserializePreferences(result[0]);
            }

            return null;
        } catch (error) {
            console.error('Error reading raw user preferences:', error);
            return null;
        }
    }

    private getDefaultPreferences(userId: string): UserPreferences {
        return {
            userId,
            targetLanguage: 'en',
            autoTranslate: true,
            showOriginalOnHover: true,
            enablePrefixDetection: true,
            notifyOnTranslation: false,
            customDictionary: new Map(),
            blockedLanguages: [],
            translationHistory: [],
        };
    }

    private serializePreferences(prefs: UserPreferences): any {
        return {
            ...prefs,
            customDictionary: prefs.customDictionary ? Array.from(prefs.customDictionary.entries()) : [],
        };
    }

    private deserializePreferences(data: any): UserPreferences {
        return {
            ...data,
            customDictionary: data.customDictionary ? new Map(data.customDictionary) : new Map(),
        };
    }
}