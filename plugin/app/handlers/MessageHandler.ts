import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { IMessage } from '@rocket.chat/apps-engine/definition/messages';
import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { TranslationService } from '../services/TranslationService';
import { UserPreferencesService } from '../services/UserPreferencesService';
import { ChannelConfigService } from '../services/ChannelConfigService';

export class MessageHandler {
    constructor(
        private translationService: TranslationService,
        private userPreferencesService: UserPreferencesService,
        private channelConfigService: ChannelConfigService,
        private logger: ILogger
    ) {}

    public async handleMessage(
        message: IMessage,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify
    ): Promise<void> {
        try {
            if (!message.text || message.text.trim() === '') {
                return;
            }

            const room = message.room;
            if (!room) {
                return;
            }

            const channelConfig = await this.channelConfigService.getChannelConfig(room.id, read, persistence);
            if (!channelConfig || !channelConfig.enabled) {
                return;
            }

            const roomUsers = await read.getRoomReader().getMembers(room.id);
            const sender = message.sender;
            
            const { detectedLanguage, originalText } = await this.detectMessageLanguage(message.text, http);

            for (const user of roomUsers) {
                if (user.id === sender.id) {
                    continue;
                }

                const userPrefs = await this.userPreferencesService.getUserPreferences(user.id, read, persistence);
                if (!userPrefs || !userPrefs.targetLanguage) {
                    continue;
                }

                if (userPrefs.targetLanguage === detectedLanguage) {
                    continue;
                }

                const translatedText = await this.translationService.translate(
                    originalText,
                    detectedLanguage,
                    userPrefs.targetLanguage,
                    http,
                    {
                        context: channelConfig.context,
                        provider: channelConfig.provider || 'auto',
                    }
                );

                if (translatedText && translatedText !== originalText) {
                    await this.createTranslatedMessage(
                        message,
                        translatedText,
                        user.id,
                        modify,
                        persistence
                    );
                }
            }
        } catch (error) {
            this.logger.error('Error handling message:', error);
        }
    }

    private async detectMessageLanguage(text: string, http: IHttp): Promise<{ detectedLanguage: string; originalText: string }> {
        const prefixMatch = text.match(/^([a-z]{2}):\s*(.+)/i);
        
        if (prefixMatch) {
            return {
                detectedLanguage: prefixMatch[1].toLowerCase(),
                originalText: prefixMatch[2],
            };
        }

        const detectedLanguage = await this.translationService.detectLanguage(text, http);
        return {
            detectedLanguage,
            originalText: text,
        };
    }

    private async createTranslatedMessage(
        originalMessage: IMessage,
        translatedText: string,
        userId: string,
        modify: IModify,
        _persistence: IPersistence
    ): Promise<void> {
        const messageBuilder = modify.getCreator().startMessage();
        
        messageBuilder
            .setRoom(originalMessage.room)
            .setSender(originalMessage.sender)
            .setText(translatedText)
            .setGroupable(false)
            .setParseUrls(true)
            .setUsernameAlias(`${originalMessage.sender.username} (translated)`)
            .addCustomField('isTranslation', true)
            .addCustomField('originalMessageId', originalMessage.id)
            .addCustomField('targetUserId', userId);

        if (originalMessage.attachments) {
            originalMessage.attachments.forEach(attachment => {
                messageBuilder.addAttachment(attachment);
            });
        }

        await modify.getCreator().finish(messageBuilder);
    }
}