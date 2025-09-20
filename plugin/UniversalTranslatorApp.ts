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

    // Slash command executors
    private async translateExecutor(context: SlashCommandContext, read: IRead, modify: IModify, http: IHttp, persistence: IPersistence): Promise<void> {
        try {
            const room = context.getRoom();
            const sender = context.getSender();
            const args = context.getArguments();

            if (!args || args.length === 0) {
                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText('Usage: `/translate <target_language> <text>` or `/translate <text>` (uses your default language)');
                await modify.getCreator().finish(messageBuilder);
                return;
            }

            let targetLanguage: string;
            let textToTranslate: string;

            // Check if first argument is a language code
            const languageCodes = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'lt'];
            if (languageCodes.includes(args[0].toLowerCase())) {
                targetLanguage = args[0].toLowerCase();
                textToTranslate = args.slice(1).join(' ');
            } else {
                // Use user's preferred language
                const userPrefs = await this.userPreferencesService.getUserPreferences(sender.id, read, persistence);
                targetLanguage = userPrefs?.targetLanguage || 'en';
                textToTranslate = args.join(' ');
            }

            if (!textToTranslate.trim()) {
                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText('Please provide text to translate.');
                await modify.getCreator().finish(messageBuilder);
                return;
            }

            // Detect source language
            const sourceLanguage = await this.translationService.detectLanguage(textToTranslate, http);

            if (sourceLanguage === targetLanguage) {
                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText(`Text is already in ${targetLanguage}. No translation needed.`);
                await modify.getCreator().finish(messageBuilder);
                return;
            }

            // Translate the text
            const translatedText = await this.translationService.translate(
                textToTranslate,
                sourceLanguage,
                targetLanguage,
                http,
                { context: 'manual_translation' }
            );

            // Send the translation
            const messageBuilder = modify.getCreator().startMessage()
                .setRoom(room)
                .setSender(sender)
                .setText(`🔄 **Translation** (${sourceLanguage} → ${targetLanguage}):\n\n**Original:** ${textToTranslate}\n**Translated:** ${translatedText}`);
            await modify.getCreator().finish(messageBuilder);

            // Add to translation history
            await this.userPreferencesService.addToHistory(
                sender.id,
                {
                    timestamp: new Date(),
                    originalText: textToTranslate,
                    translatedText,
                    sourceLanguage,
                    targetLanguage,
                    provider: 'manual'
                },
                read,
                persistence
            );

        } catch (error) {
            this.getLogger().error('Error in translate command:', error);
            const messageBuilder = modify.getCreator().startMessage()
                .setRoom(context.getRoom())
                .setSender(context.getSender())
                .setText('❌ Translation failed. Please try again later.');
            await modify.getCreator().finish(messageBuilder);
        }
    }

    private async myLangExecutor(context: SlashCommandContext, read: IRead, modify: IModify, _http: IHttp, persistence: IPersistence): Promise<void> {
        try {
            const room = context.getRoom();
            const sender = context.getSender();
            const args = context.getArguments();

            if (!args || args.length === 0) {
                // Show current language preference
                const userPrefs = await this.userPreferencesService.getUserPreferences(sender.id, read, persistence);
                const currentLang = userPrefs?.targetLanguage || 'en';

                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText(`🌐 Your current language preference: **${currentLang}**\n\nTo change it, use: \`/mylang <language_code>\`\n\nSupported languages: en, es, fr, de, pt, it, ru, zh, ja, ko, ar, hi, lt`);
                await modify.getCreator().finish(messageBuilder);
                return;
            }

            const newLanguage = args[0].toLowerCase();
            const supportedLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'lt'];

            if (!supportedLanguages.includes(newLanguage)) {
                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText(`❌ Unsupported language code: **${newLanguage}**\n\nSupported languages: ${supportedLanguages.join(', ')}`);
                await modify.getCreator().finish(messageBuilder);
                return;
            }

            // Update user preferences
            const success = await this.userPreferencesService.updateUserLanguage(
                sender.id,
                newLanguage,
                read,
                persistence
            );

            if (success) {
                const languageNames: { [key: string]: string } = {
                    'en': 'English',
                    'es': 'Spanish',
                    'fr': 'French',
                    'de': 'German',
                    'pt': 'Portuguese',
                    'it': 'Italian',
                    'ru': 'Russian',
                    'zh': 'Chinese',
                    'ja': 'Japanese',
                    'ko': 'Korean',
                    'ar': 'Arabic',
                    'hi': 'Hindi',
                    'lt': 'Lithuanian'
                };

                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText(`✅ Language preference updated to **${languageNames[newLanguage]}** (${newLanguage})`);
                await modify.getCreator().finish(messageBuilder);
            } else {
                const messageBuilder = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(sender)
                    .setText('❌ Failed to update language preference. Please try again.');
                await modify.getCreator().finish(messageBuilder);
            }

        } catch (error) {
            this.getLogger().error('Error in mylang command:', error);
            const messageBuilder = modify.getCreator().startMessage()
                .setRoom(context.getRoom())
                .setSender(context.getSender())
                .setText('❌ Command failed. Please try again later.');
            await modify.getCreator().finish(messageBuilder);
        }
    }

    // API endpoint handlers (placeholder implementations)
    private async healthEndpoint(_request: any, _endpoint: any, _read: IRead, _modify: IModify, _http: IHttp, _persistence: IPersistence): Promise<any> {
        return { status: 'ok' };
    }

    private async translateEndpoint(request: any, _endpoint: any, _read: IRead, _modify: IModify, http: IHttp, _persistence: IPersistence): Promise<any> {
        try {
            const { text, sourceLanguage, targetLanguage, provider, context: translationContext } = request.content;

            if (!text || !targetLanguage) {
                return {
                    statusCode: 400,
                    content: {
                        success: false,
                        error: 'Missing required parameters: text and targetLanguage'
                    }
                };
            }

            const detectedSourceLanguage = sourceLanguage || await this.translationService.detectLanguage(text, http);

            if (detectedSourceLanguage === targetLanguage) {
                return {
                    statusCode: 200,
                    content: {
                        success: true,
                        translation: text,
                        sourceLanguage: detectedSourceLanguage,
                        targetLanguage,
                        provider: 'none',
                        confidence: 1.0,
                        cached: false
                    }
                };
            }

            const translatedText = await this.translationService.translate(
                text,
                detectedSourceLanguage,
                targetLanguage,
                http,
                {
                    provider,
                    context: translationContext
                }
            );

            return {
                statusCode: 200,
                content: {
                    success: true,
                    translation: translatedText,
                    sourceLanguage: detectedSourceLanguage,
                    targetLanguage,
                    provider: provider || 'auto',
                    confidence: 0.95,
                    cached: false
                }
            };

        } catch (error) {
            this.getLogger().error('Translation endpoint error:', error);
            return {
                statusCode: 500,
                content: {
                    success: false,
                    error: 'Translation service error'
                }
            };
        }
    }

    private async getPreferencesEndpoint(request: any, _endpoint: any, read: IRead, _modify: IModify, _http: IHttp, persistence: IPersistence): Promise<any> {
        try {
            const { userId } = request.query || {};

            if (!userId) {
                return {
                    statusCode: 400,
                    content: {
                        success: false,
                        error: 'Missing required parameter: userId'
                    }
                };
            }

            const userPrefs = await this.userPreferencesService.getUserPreferences(userId, read, persistence);

            if (!userPrefs) {
                return {
                    statusCode: 404,
                    content: {
                        success: false,
                        error: 'User preferences not found'
                    }
                };
            }

            // Convert Map objects to plain objects for JSON serialization
            const serializedPrefs = {
                ...userPrefs,
                customDictionary: userPrefs.customDictionary ? Object.fromEntries(userPrefs.customDictionary) : {},
                translationHistory: userPrefs.translationHistory || []
            };

            return {
                statusCode: 200,
                content: {
                    success: true,
                    preferences: serializedPrefs
                }
            };

        } catch (error) {
            this.getLogger().error('Get preferences endpoint error:', error);
            return {
                statusCode: 500,
                content: {
                    success: false,
                    error: 'Failed to retrieve user preferences'
                }
            };
        }
    }

    private async setPreferencesEndpoint(request: any, _endpoint: any, read: IRead, _modify: IModify, _http: IHttp, persistence: IPersistence): Promise<any> {
        try {
            const { userId, preferences } = request.content;

            if (!userId || !preferences) {
                return {
                    statusCode: 400,
                    content: {
                        success: false,
                        error: 'Missing required parameters: userId and preferences'
                    }
                };
            }

            // Validate language codes if provided
            const supportedLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'lt'];

            if (preferences.targetLanguage && !supportedLanguages.includes(preferences.targetLanguage)) {
                return {
                    statusCode: 400,
                    content: {
                        success: false,
                        error: `Unsupported target language: ${preferences.targetLanguage}`
                    }
                };
            }

            if (preferences.sourceLanguage && !supportedLanguages.includes(preferences.sourceLanguage)) {
                return {
                    statusCode: 400,
                    content: {
                        success: false,
                        error: `Unsupported source language: ${preferences.sourceLanguage}`
                    }
                };
            }

            // Convert plain object customDictionary back to Map if provided
            if (preferences.customDictionary && typeof preferences.customDictionary === 'object') {
                preferences.customDictionary = new Map(Object.entries(preferences.customDictionary));
            }

            const success = await this.userPreferencesService.setUserPreferences(
                userId,
                preferences,
                read,
                persistence
            );

            if (success) {
                return {
                    statusCode: 200,
                    content: {
                        success: true,
                        message: 'User preferences updated successfully'
                    }
                };
            } else {
                return {
                    statusCode: 500,
                    content: {
                        success: false,
                        error: 'Failed to update user preferences'
                    }
                };
            }

        } catch (error) {
            this.getLogger().error('Set preferences endpoint error:', error);
            return {
                statusCode: 500,
                content: {
                    success: false,
                    error: 'Failed to update user preferences'
                }
            };
        }
    }

    private async statsEndpoint(request: any, _endpoint: any, read: IRead, _modify: IModify, _http: IHttp, persistence: IPersistence): Promise<any> {
        try {
            const { roomId, userId, type = 'summary' } = request.query || {};

            switch (type) {
                case 'channel':
                    if (!roomId) {
                        return {
                            statusCode: 400,
                            content: {
                                success: false,
                                error: 'Missing required parameter: roomId for channel stats'
                            }
                        };
                    }

                    const channelStats = await this.channelConfigService.getChannelStats(roomId, read, persistence);
                    return {
                        statusCode: 200,
                        content: {
                            success: true,
                            stats: {
                                ...channelStats,
                                languagePairs: Object.fromEntries(channelStats.languagePairs)
                            }
                        }
                    };

                case 'user':
                    if (!userId) {
                        return {
                            statusCode: 400,
                            content: {
                                success: false,
                                error: 'Missing required parameter: userId for user stats'
                            }
                        };
                    }

                    const userHistory = await this.userPreferencesService.getTranslationHistory(userId, read, persistence);
                    const userPrefs = await this.userPreferencesService.getUserPreferences(userId, read, persistence);

                    return {
                        statusCode: 200,
                        content: {
                            success: true,
                            stats: {
                                userId,
                                totalTranslations: userHistory.length,
                                preferredLanguage: userPrefs?.targetLanguage || 'en',
                                autoTranslateEnabled: userPrefs?.autoTranslate || false,
                                recentTranslations: userHistory.slice(0, 10),
                                languageUsage: this.calculateLanguageUsage(userHistory)
                            }
                        }
                    };

                case 'summary':
                default:
                    // Global stats
                    const cacheStats = this.translationService.getCacheStats();

                    return {
                        statusCode: 200,
                        content: {
                            success: true,
                            stats: {
                                type: 'global',
                                cache: cacheStats,
                                uptime: process.uptime(),
                                timestamp: new Date().toISOString()
                            }
                        }
                    };
            }

        } catch (error) {
            this.getLogger().error('Stats endpoint error:', error);
            return {
                statusCode: 500,
                content: {
                    success: false,
                    error: 'Failed to retrieve statistics'
                }
            };
        }
    }

    private calculateLanguageUsage(history: any[]): { [key: string]: number } {
        const usage: { [key: string]: number } = {};

        history.forEach(entry => {
            const pair = `${entry.sourceLanguage}-${entry.targetLanguage}`;
            usage[pair] = (usage[pair] || 0) + 1;
        });

        return usage;
    }
}