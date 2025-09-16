import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { IUIKitResponse, UIKitBlockInteractionContext } from '@rocket.chat/apps-engine/definition/uikit';
import { IUser } from '@rocket.chat/apps-engine/definition/users';

export class UIHandler {
    constructor(private logger: ILogger) {}

    public async handleBlockAction(
        context: UIKitBlockInteractionContext,
        user: IUser
    ): Promise<IUIKitResponse> {
        const { actionId, value } = context.getInteractionData();

        this.logger.info(`UI action: ${actionId} from user: ${user.username}`);

        switch (actionId) {
            case 'user-language-preference':
                return this.handleLanguagePreference(value || '', user);
            
            case 'channel-translation-config':
                return this.handleChannelConfig(value, context);
            
            case 'save-preferences':
                return this.handleSavePreferences(context, user);
            
            case 'toggle-translation':
                return this.handleToggleTranslation(context, user);
            
            default:
                this.logger.warn(`Unknown action: ${actionId}`);
                return this.createResponse(false, 'Unknown action');
        }
    }

    private async handleLanguagePreference(language: string, user: IUser): Promise<IUIKitResponse> {
        try {
            this.logger.info(`Setting language preference for ${user.username}: ${language}`);
            
            return this.createResponse(true, `Language preference set to ${language}`);
        } catch (error) {
            this.logger.error('Error setting language preference:', error);
            return this.createResponse(false, 'Failed to set language preference');
        }
    }

    private async handleChannelConfig(_config: any, context: UIKitBlockInteractionContext): Promise<IUIKitResponse> {
        try {
            const room = context.getInteractionData().room;
            if (!room) {
                return this.createResponse(false, 'No room context available');
            }

            this.logger.info(`Configuring translation for channel: ${room.id}`);
            
            return this.createResponse(true, 'Channel translation configured');
        } catch (error) {
            this.logger.error('Error configuring channel:', error);
            return this.createResponse(false, 'Failed to configure channel');
        }
    }

    private async handleSavePreferences(context: UIKitBlockInteractionContext, user: IUser): Promise<IUIKitResponse> {
        try {
            const data = context.getInteractionData();
            this.logger.info(`Saving preferences for ${user.username}:`, data);
            
            return this.createResponse(true, 'Preferences saved successfully');
        } catch (error) {
            this.logger.error('Error saving preferences:', error);
            return this.createResponse(false, 'Failed to save preferences');
        }
    }

    private async handleToggleTranslation(context: UIKitBlockInteractionContext, user: IUser): Promise<IUIKitResponse> {
        try {
            const enabled = context.getInteractionData().value === 'true';
            this.logger.info(`Translation ${enabled ? 'enabled' : 'disabled'} for ${user.username}`);
            
            return this.createResponse(true, `Translation ${enabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            this.logger.error('Error toggling translation:', error);
            return this.createResponse(false, 'Failed to toggle translation');
        }
    }

    private createResponse(success: boolean, _message: string): IUIKitResponse {
        return {
            success,
        };
    }

    public createLanguageSelectionModal(): any {
        return {
            title: 'Select Your Language',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: 'Choose your preferred language for reading messages:',
                    },
                },
                {
                    type: 'input',
                    element: {
                        type: 'static_select',
                        actionId: 'language-select',
                        placeholder: {
                            type: 'plain_text',
                            text: 'Select a language',
                        },
                        options: this.getLanguageOptions(),
                    },
                    label: {
                        type: 'plain_text',
                        text: 'Reading Language',
                    },
                },
                {
                    type: 'input',
                    element: {
                        type: 'checkbox',
                        actionId: 'auto-translate',
                        options: [
                            {
                                text: {
                                    type: 'plain_text',
                                    text: 'Automatically translate messages',
                                },
                                value: 'auto',
                            },
                        ],
                    },
                    label: {
                        type: 'plain_text',
                        text: 'Auto-Translation',
                    },
                },
            ],
            submit: {
                type: 'plain_text',
                text: 'Save',
            },
            close: {
                type: 'plain_text',
                text: 'Cancel',
            },
        };
    }

    private getLanguageOptions(): any[] {
        return [
            { text: { type: 'plain_text', text: 'English' }, value: 'en' },
            { text: { type: 'plain_text', text: 'Spanish' }, value: 'es' },
            { text: { type: 'plain_text', text: 'French' }, value: 'fr' },
            { text: { type: 'plain_text', text: 'German' }, value: 'de' },
            { text: { type: 'plain_text', text: 'Portuguese' }, value: 'pt' },
            { text: { type: 'plain_text', text: 'Italian' }, value: 'it' },
            { text: { type: 'plain_text', text: 'Russian' }, value: 'ru' },
            { text: { type: 'plain_text', text: 'Chinese' }, value: 'zh' },
            { text: { type: 'plain_text', text: 'Japanese' }, value: 'ja' },
            { text: { type: 'plain_text', text: 'Korean' }, value: 'ko' },
            { text: { type: 'plain_text', text: 'Arabic' }, value: 'ar' },
            { text: { type: 'plain_text', text: 'Hindi' }, value: 'hi' },
            { text: { type: 'plain_text', text: 'Lithuanian' }, value: 'lt' },
        ];
    }
}