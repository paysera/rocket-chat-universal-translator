import { ILogger } from '@rocket.chat/apps-engine/definition/accessors';
import { IUIKitResponse, UIKitBlockInteractionContext } from '@rocket.chat/apps-engine/definition/uikit';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
export declare class UIHandler {
    private logger;
    constructor(logger: ILogger);
    handleBlockAction(context: UIKitBlockInteractionContext, user: IUser): Promise<IUIKitResponse>;
    private handleLanguagePreference;
    private handleChannelConfig;
    private handleSavePreferences;
    private handleToggleTranslation;
    private createResponse;
    createLanguageSelectionModal(): any;
    private getLanguageOptions;
}
//# sourceMappingURL=UIHandler.d.ts.map