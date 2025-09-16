import { body, query, ValidationChain, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

export class TranslationValidator {
    // Validation rules for single translation
    validateSingleTranslation(): ValidationChain[] {
        return [
            body('text')
                .notEmpty()
                .withMessage('Text is required')
                .isLength({ min: 1, max: 10000 })
                .withMessage('Text must be between 1 and 10000 characters'),
            body('targetLanguage')
                .notEmpty()
                .withMessage('Target language is required')
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid language code'),
            body('sourceLanguage')
                .optional()
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid source language code'),
            body('provider')
                .optional()
                .isIn(['auto', 'claude', 'openai', 'deepl', 'google', 'azure'])
                .withMessage('Invalid provider'),
            body('context')
                .optional()
                .isString()
                .isLength({ max: 1000 })
                .withMessage('Context must be a string with max 1000 characters'),
            body('preserveFormatting')
                .optional()
                .isBoolean()
                .withMessage('Preserve formatting must be a boolean'),
            body('glossary')
                .optional()
                .isObject()
                .withMessage('Glossary must be an object')
        ];
    }

    // Validation rules for batch translation
    validateBatchTranslation(): ValidationChain[] {
        return [
            body('messages')
                .isArray({ min: 1, max: 100 })
                .withMessage('Messages must be an array with 1-100 items'),
            body('messages.*.id')
                .notEmpty()
                .withMessage('Each message must have an id'),
            body('messages.*.text')
                .notEmpty()
                .isLength({ min: 1, max: 10000 })
                .withMessage('Each message text must be between 1 and 10000 characters'),
            body('targetLanguage')
                .notEmpty()
                .withMessage('Target language is required')
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid language code'),
            body('sourceLanguage')
                .optional()
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid source language code'),
            body('provider')
                .optional()
                .isIn(['auto', 'claude', 'openai', 'deepl', 'google', 'azure'])
                .withMessage('Invalid provider')
        ];
    }

    // Validation rules for language detection
    validateLanguageDetection(): ValidationChain[] {
        return [
            body('text')
                .notEmpty()
                .withMessage('Text is required')
                .isLength({ min: 1, max: 1000 })
                .withMessage('Text must be between 1 and 1000 characters'),
            body('hints')
                .optional()
                .isArray()
                .withMessage('Hints must be an array')
        ];
    }

    // Validation rules for preference updates
    validatePreferences(): ValidationChain[] {
        return [
            body('defaultSourceLanguage')
                .optional()
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid default source language code'),
            body('defaultTargetLanguage')
                .optional()
                .isLength({ min: 2, max: 5 })
                .withMessage('Invalid default target language code'),
            body('preferredProvider')
                .optional()
                .isIn(['auto', 'claude', 'openai', 'deepl', 'google', 'azure'])
                .withMessage('Invalid preferred provider'),
            body('qualityLevel')
                .optional()
                .isIn(['standard', 'quality'])
                .withMessage('Quality level must be either "standard" or "quality"'),
            body('cacheEnabled')
                .optional()
                .isBoolean()
                .withMessage('Cache enabled must be a boolean'),
            body('preserveFormatting')
                .optional()
                .isBoolean()
                .withMessage('Preserve formatting must be a boolean')
        ];
    }

    // Middleware to handle validation errors
    handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
            return;
        }
        next();
    }

    // Helper method to validate language codes
    static isValidLanguageCode(code: string): boolean {
        const supportedLanguages = [
            'en', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'zh', 'ja', 'ko',
            'ar', 'hi', 'lt', 'pl', 'uk', 'tr', 'nl', 'sv', 'no', 'da',
            'fi', 'cs', 'hu', 'ro', 'bg', 'el', 'he', 'th', 'vi', 'id'
        ];
        return supportedLanguages.includes(code);
    }

    // Helper method to validate provider names
    static isValidProvider(provider: string): boolean {
        const supportedProviders = ['auto', 'claude', 'openai', 'deepl', 'google', 'azure'];
        return supportedProviders.includes(provider);
    }

    // Custom validation for domain-specific translations
    validateDomainSpecific(): ValidationChain[] {
        return [
            body('domain')
                .optional()
                .isIn(['legal', 'medical', 'creative', 'technical', 'general'])
                .withMessage('Invalid domain type'),
            body('quality')
                .optional()
                .isIn(['standard', 'quality'])
                .withMessage('Quality must be either "standard" or "quality"')
        ];
    }
}