import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { ISetting } from '@rocket.chat/apps-engine/definition/settings';

export class SettingsHandler {
    private settings: Map<string, any> = new Map();

    constructor(private logger: ILogger) {}

    public updateSetting(setting: ISetting): void {
        this.settings.set(setting.id, setting.value);
        this.logger.info(`Setting updated: ${setting.id} = ${setting.value}`);
    }

    public getSetting(id: string): any {
        return this.settings.get(id);
    }

    public getAllSettings(): Map<string, any> {
        return new Map(this.settings);
    }

    public validateApiKey(apiKey: string): boolean {
        if (!apiKey || apiKey.trim() === '') {
            this.logger.error('API key is empty');
            return false;
        }

        if (apiKey.length < 32) {
            this.logger.error('API key is too short');
            return false;
        }

        return true;
    }

    public validateApiEndpoint(endpoint: string): boolean {
        try {
            const url = new URL(endpoint);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                this.logger.error('Invalid API endpoint protocol');
                return false;
            }
            return true;
        } catch (error) {
            this.logger.error('Invalid API endpoint URL:', error);
            return false;
        }
    }

    public getProviderSettings(provider: string): any {
        const providerKey = `provider_${provider}`;
        return {
            apiKey: this.settings.get(`${providerKey}_api_key`),
            endpoint: this.settings.get(`${providerKey}_endpoint`),
            model: this.settings.get(`${providerKey}_model`),
            maxTokens: this.settings.get(`${providerKey}_max_tokens`) || 1000,
            temperature: this.settings.get(`${providerKey}_temperature`) || 0.3,
        };
    }

    public getCacheSettings(): any {
        return {
            enabled: this.settings.get('cache_enabled') !== false,
            ttl: this.settings.get('cache_ttl') || 3600,
            maxSize: this.settings.get('cache_max_size') || 1000,
        };
    }

    public getTranslationSettings(): any {
        return {
            defaultLanguage: this.settings.get('default_language') || 'en',
            enableHoverOriginal: this.settings.get('enable_hover_original') !== false,
            enablePrefixTranslation: this.settings.get('enable_prefix_translation') !== false,
            maxMessageLength: this.settings.get('max_message_length') || 5000,
            translationProvider: this.settings.get('translation_provider') || 'auto',
        };
    }

    public getBillingSettings(): any {
        return {
            trackUsage: this.settings.get('track_usage') !== false,
            billingEndpoint: this.settings.get('billing_endpoint'),
            costMarkup: this.settings.get('cost_markup') || 1.05,
            freeQuota: this.settings.get('free_quota') || 0,
        };
    }
}