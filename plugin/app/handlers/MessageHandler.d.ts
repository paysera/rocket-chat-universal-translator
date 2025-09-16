import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IMessage } from '@rocket.chat/apps-engine/definition/messages';
import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { TranslationService } from '../services/TranslationService';
import { UserPreferencesService } from '../services/UserPreferencesService';
import { ChannelConfigService } from '../services/ChannelConfigService';
export declare class MessageHandler {
    private translationService;
    private userPreferencesService;
    private channelConfigService;
    private logger;
    constructor(translationService: TranslationService, userPreferencesService: UserPreferencesService, channelConfigService: ChannelConfigService, logger: ILogger);
    handleMessage(message: IMessage, read: IRead, http: IHttp, persistence: IPersistence, modify: IModify): Promise<void>;
    private detectMessageLanguage;
    private createTranslatedMessage;
}
//# sourceMappingURL=MessageHandler.d.ts.map