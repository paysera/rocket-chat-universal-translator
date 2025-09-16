import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { ISetting } from '@rocket.chat/apps-engine/definition/settings';
export declare class SettingsHandler {
    private logger;
    private settings;
    constructor(logger: ILogger);
    updateSetting(setting: ISetting): void;
    getSetting(id: string): any;
    getAllSettings(): Map<string, any>;
    validateApiKey(apiKey: string): boolean;
    validateApiEndpoint(endpoint: string): boolean;
    getProviderSettings(provider: string): any;
    getCacheSettings(): any;
    getTranslationSettings(): any;
    getBillingSettings(): any;
}
//# sourceMappingURL=SettingsHandler.d.ts.map