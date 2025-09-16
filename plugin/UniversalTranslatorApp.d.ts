import { IAppAccessors, IConfigurationExtend, IEnvironmentRead, IHttp, ILogger, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IPostMessageSent } from '@rocket.chat/apps-engine/definition/messages';
export declare class UniversalTranslatorApp extends App implements IPostMessageSent {
    private messageHandler;
    private translationService;
    private userPreferencesService;
    private channelConfigService;
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors);
    initialize(configurationExtend: IConfigurationExtend, _environmentRead: IEnvironmentRead): Promise<void>;
    protected extendConfiguration(configuration: IConfigurationExtend): Promise<void>;
    private registerUIElements;
    private registerCommands;
    private registerEndpoints;
    executePostMessageSent(message: any, read: IRead, http: IHttp, persistence: IPersistence, modify: IModify): Promise<void>;
    private translateExecutor;
    private myLangExecutor;
    private healthEndpoint;
    private translateEndpoint;
    private getPreferencesEndpoint;
    private setPreferencesEndpoint;
    private statsEndpoint;
}
//# sourceMappingURL=UniversalTranslatorApp.d.ts.map