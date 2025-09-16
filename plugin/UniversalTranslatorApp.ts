import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { ISetting, SettingType } from '@rocket.chat/apps-engine/definition/settings';
import { IPostMessageSent } from '@rocket.chat/apps-engine/definition/messages';
import { UIActionButtonContext } from '@rocket.chat/apps-engine/definition/ui';
import { ApiVisibility, ApiSecurity } from '@rocket.chat/apps-engine/definition/api';
import { SlashCommandContext } from '@rocket.chat/apps-engine/definition/slashcommands';
import { MessageHandler } from './app/handlers/MessageHandler';
import { TranslationService } from './app/services/TranslationService';
import { UserPreferencesService } from './app/services/UserPreferencesService';
import { ChannelConfigService } from './app/services/ChannelConfigService';

export class UniversalTranslatorApp extends App implements IPostMessageSent {
    private messageHandler!: MessageHandler;
    private translationService!: TranslationService;
    private userPreferencesService!: UserPreferencesService;
    private channelConfigService!: ChannelConfigService;

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async initialize(configurationExtend: IConfigurationExtend, _environmentRead: IEnvironmentRead): Promise<void> {
        await this.extendConfiguration(configurationExtend);
        
        this.translationService = new TranslationService(this.getLogger());
        this.userPreferencesService = new UserPreferencesService();
        this.channelConfigService = new ChannelConfigService();
        
        this.messageHandler = new MessageHandler(
            this.translationService,
            this.userPreferencesService,
            this.channelConfigService,
            this.getLogger()
        );
        
        // Initialize handlers (currently unused but may be needed for future features)

        this.getLogger().info('Universal Translator Pro initialized successfully');
    }

    protected async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        const settings: ISetting[] = [
            {
                id: 'api_endpoint',
                type: SettingType.STRING,
                packageValue: 'https://translator.noreika.lt',
                required: true,
                public: false,
                i18nLabel: 'API_Endpoint',
                i18nDescription: 'API_Endpoint_Description',
            },
            {
                id: 'api_key',
                type: SettingType.PASSWORD,
                packageValue: '',
                required: true,
                public: false,
                i18nLabel: 'API_Key',
                i18nDescription: 'API_Key_Description',
            },
            {
                id: 'default_language',
                type: SettingType.SELECT,
                packageValue: 'en',
                required: true,
                public: true,
                values: [
                    { key: 'en', i18nLabel: 'English' },
                    { key: 'es', i18nLabel: 'Spanish' },
                    { key: 'fr', i18nLabel: 'French' },
                    { key: 'de', i18nLabel: 'German' },
                    { key: 'pt', i18nLabel: 'Portuguese' },
                    { key: 'it', i18nLabel: 'Italian' },
                    { key: 'ru', i18nLabel: 'Russian' },
                    { key: 'zh', i18nLabel: 'Chinese' },
                    { key: 'ja', i18nLabel: 'Japanese' },
                    { key: 'ko', i18nLabel: 'Korean' },
                    { key: 'ar', i18nLabel: 'Arabic' },
                    { key: 'hi', i18nLabel: 'Hindi' },
                    { key: 'lt', i18nLabel: 'Lithuanian' },
                ],
                i18nLabel: 'Default_Language',
                i18nDescription: 'Default_Language_Description',
            },
            {
                id: 'translation_provider',
                type: SettingType.SELECT,
                packageValue: 'auto',
                required: true,
                public: false,
                values: [
                    { key: 'auto', i18nLabel: 'Auto_Select' },
                    { key: 'claude', i18nLabel: 'Claude_AI' },
                    { key: 'openai', i18nLabel: 'OpenAI_GPT' },
                    { key: 'deepl', i18nLabel: 'DeepL_AI' },
                ],
                i18nLabel: 'Translation_Provider',
                i18nDescription: 'Translation_Provider_Description',
            },
            {
                id: 'enable_hover_original',
                type: SettingType.BOOLEAN,
                packageValue: true,
                required: false,
                public: true,
                i18nLabel: 'Enable_Hover_Original',
                i18nDescription: 'Enable_Hover_Original_Description',
            },
            {
                id: 'enable_prefix_translation',
                type: SettingType.BOOLEAN,
                packageValue: true,
                required: false,
                public: true,
                i18nLabel: 'Enable_Prefix_Translation',
                i18nDescription: 'Enable_Prefix_Translation_Description',
            },
            {
                id: 'cache_ttl',
                type: SettingType.NUMBER,
                packageValue: 3600,
                required: false,
                public: false,
                i18nLabel: 'Cache_TTL',
                i18nDescription: 'Cache_TTL_Description',
            },
            {
                id: 'max_message_length',
                type: SettingType.NUMBER,
                packageValue: 5000,
                required: false,
                public: false,
                i18nLabel: 'Max_Message_Length',
                i18nDescription: 'Max_Message_Length_Description',
            },
        ];

        for (const setting of settings) {
            await configuration.settings.provideSetting(setting);
        }

        this.registerUIElements(configuration);
        this.registerCommands(configuration);
        this.registerEndpoints(configuration);
    }

    private registerUIElements(configuration: IConfigurationExtend): void {
        configuration.ui.registerButton({
            actionId: 'user-language-preference',
            labelI18n: 'Set_Language_Preference',
            context: UIActionButtonContext.USER_DROPDOWN_ACTION,
        });

        configuration.ui.registerButton({
            actionId: 'channel-translation-config',
            labelI18n: 'Configure_Channel_Translation',
            context: UIActionButtonContext.ROOM_ACTION,
        });
    }

    private registerCommands(configuration: IConfigurationExtend): void {
        configuration.slashCommands.provideSlashCommand({
            command: 'translate',
            i18nDescription: 'Translate_Command_Description',
            i18nParamsExample: 'Translate_Command_Example',
            providesPreview: false,
            executor: this.translateExecutor.bind(this),
        });

        configuration.slashCommands.provideSlashCommand({
            command: 'mylang',
            i18nDescription: 'MyLang_Command_Description',
            i18nParamsExample: 'MyLang_Command_Example',
            providesPreview: false,
            executor: this.myLangExecutor.bind(this),
        });
    }

    private registerEndpoints(configuration: IConfigurationExtend): void {
        configuration.api.provideApi({
            visibility: ApiVisibility.PUBLIC,
            security: ApiSecurity.UNSECURE,
            endpoints: [
                {
                    path: 'health',
                    get: this.healthEndpoint.bind(this),
                },
                {
                    path: 'translate',
                    post: this.translateEndpoint.bind(this),
                },
                {
                    path: 'preferences',
                    get: this.getPreferencesEndpoint.bind(this),
                    post: this.setPreferencesEndpoint.bind(this),
                },
                {
                    path: 'stats',
                    get: this.statsEndpoint.bind(this),
                },
            ],
        });
    }

    public async executePostMessageSent(
        message: any,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify
    ): Promise<void> {
        await this.messageHandler.handleMessage(message, read, http, persistence, modify);
    }

    // Slash command executors (placeholder implementations)
    private async translateExecutor(_context: SlashCommandContext, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<void> {
        // TODO: Implement translate command
    }

    private async myLangExecutor(_context: SlashCommandContext, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<void> {
        // TODO: Implement mylang command
    }

    // API endpoint handlers (placeholder implementations)
    private async healthEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        return { status: 'ok' };
    }

    private async translateEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        // TODO: Implement translate endpoint
        return { error: 'Not implemented' };
    }

    private async getPreferencesEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        // TODO: Implement get preferences endpoint
        return { error: 'Not implemented' };
    }

    private async setPreferencesEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        // TODO: Implement set preferences endpoint
        return { error: 'Not implemented' };
    }

    private async statsEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        // TODO: Implement stats endpoint
        return { error: 'Not implemented' };
    }
}