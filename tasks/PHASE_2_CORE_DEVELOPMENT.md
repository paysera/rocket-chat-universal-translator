# 🚀 Phase 2: Core Development Tasks
**Duration**: Weeks 3-6  
**Priority**: Critical Path  
**Team**: Backend + Frontend + AI Integration

---

## Week 3-4: Translation Engine Development

### AI Provider Integration Layer

#### Task 3.1: Provider Interface Definition
```typescript
// shared/types/providers.ts
export interface ITranslationProvider {
  name: string;
  supportedLanguages: string[];
  maxTokens: number;
  costPerToken: number;
  
  initialize(): Promise<void>;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  detectLanguage(text: string): Promise<LanguageDetection>;
  healthCheck(): Promise<ProviderHealth>;
  estimateCost(text: string, targetLang: string): Promise<CostEstimate>;
}

export interface TranslationRequest {
  text: string;
  sourceLang: string | 'auto';
  targetLang: string;
  context?: string;
  quality?: 'economy' | 'balanced' | 'premium';
  maxCost?: number;
  timeout?: number;
}

export interface TranslationResponse {
  translatedText: string;
  originalText: string;
  sourceLang: string;
  targetLang: string;
  confidence: number;
  provider: string;
  model: string;
  cost: {
    amount: number;
    currency: string;
    tokensUsed: number;
  };
  metadata: {
    translationTimeMs: number;
    cacheHit: boolean;
    requestId: string;
  };
}
```

#### Task 3.2: OpenAI Provider Implementation
```typescript
// api/src/providers/OpenAIProvider.ts
import OpenAI from 'openai';
import { ITranslationProvider, TranslationRequest, TranslationResponse } from '@shared/types/providers';

export class OpenAIProvider implements ITranslationProvider {
  name = 'openai';
  supportedLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'];
  maxTokens = 4096;
  costPerToken = 0.00002; // GPT-4 pricing
  
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4-turbo-preview') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async initialize(): Promise<void> {
    // Test API connection
    await this.healthCheck();
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    
    const systemPrompt = this.buildSystemPrompt(request);
    const userPrompt = this.buildUserPrompt(request);
    
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: Math.min(request.text.length * 2, this.maxTokens),
      });

      const translatedText = completion.choices[0].message.content || '';
      const tokensUsed = completion.usage?.total_tokens || 0;

      return {
        translatedText,
        originalText: request.text,
        sourceLang: request.sourceLang === 'auto' ? 
          await this.detectLanguage(request.text) : request.sourceLang,
        targetLang: request.targetLang,
        confidence: 0.95,
        provider: this.name,
        model: this.model,
        cost: {
          amount: tokensUsed * this.costPerToken,
          currency: 'EUR',
          tokensUsed,
        },
        metadata: {
          translationTimeMs: Date.now() - startTime,
          cacheHit: false,
          requestId: crypto.randomUUID(),
        },
      };
    } catch (error) {
      throw new Error(`OpenAI translation failed: ${error.message}`);
    }
  }

  private buildSystemPrompt(request: TranslationRequest): string {
    let prompt = `You are a professional translator specializing in accurate, context-aware translations.`;
    
    if (request.context) {
      prompt += ` Use the following conversation context to improve translation accuracy:\n${request.context}`;
    }
    
    prompt += ` Translate from ${request.sourceLang} to ${request.targetLang}.`;
    prompt += ` Preserve technical terms, proper nouns, and maintain the original tone and style.`;
    prompt += ` Only return the translated text without any explanations.`;
    
    return prompt;
  }

  private buildUserPrompt(request: TranslationRequest): string {
    return request.text;
  }

  async detectLanguage(text: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'Detect the language of the text. Return only the ISO 639-1 language code.' 
        },
        { role: 'user', content: text }
      ],
      temperature: 0,
      max_tokens: 10,
    });

    return completion.choices[0].message.content?.trim().toLowerCase() || 'en';
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const response = await this.client.models.list();
      return {
        status: 'healthy',
        latency: 100,
        available: true,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: 0,
        available: false,
        error: error.message,
      };
    }
  }

  async estimateCost(text: string, targetLang: string): Promise<CostEstimate> {
    const estimatedTokens = Math.ceil(text.length / 4) * 2; // Rough estimate
    return {
      estimatedCost: estimatedTokens * this.costPerToken,
      estimatedTokens,
      currency: 'EUR',
    };
  }
}
```

#### Task 3.3: Anthropic Claude Provider
```typescript
// api/src/providers/ClaudeProvider.ts
import Anthropic from '@anthropic-ai/sdk';
import { ITranslationProvider, TranslationRequest, TranslationResponse } from '@shared/types/providers';

export class ClaudeProvider implements ITranslationProvider {
  name = 'anthropic';
  supportedLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi'];
  maxTokens = 100000; // Claude 3 context window
  costPerToken = 0.00003; // Claude 3 Sonnet pricing
  
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-3-sonnet-20240229') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    
    const prompt = this.buildPrompt(request);
    
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(request.text.length * 2, 4096),
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const translatedText = message.content[0].text;
      const tokensUsed = message.usage.input_tokens + message.usage.output_tokens;

      return {
        translatedText,
        originalText: request.text,
        sourceLang: request.sourceLang === 'auto' ? 
          await this.detectLanguage(request.text) : request.sourceLang,
        targetLang: request.targetLang,
        confidence: 0.96,
        provider: this.name,
        model: this.model,
        cost: {
          amount: tokensUsed * this.costPerToken,
          currency: 'EUR',
          tokensUsed,
        },
        metadata: {
          translationTimeMs: Date.now() - startTime,
          cacheHit: false,
          requestId: crypto.randomUUID(),
        },
      };
    } catch (error) {
      throw new Error(`Claude translation failed: ${error.message}`);
    }
  }

  private buildPrompt(request: TranslationRequest): string {
    let prompt = `Translate the following text from ${request.sourceLang} to ${request.targetLang}.\n\n`;
    
    if (request.context) {
      prompt += `Context for better translation:\n${request.context}\n\n`;
    }
    
    prompt += `Requirements:
    - Preserve technical terms and proper nouns
    - Maintain the original tone and formality level
    - Keep formatting intact (line breaks, punctuation)
    - For ambiguous terms, choose the most contextually appropriate translation
    
    Text to translate:
    ${request.text}
    
    Translation:`;
    
    return prompt;
  }

  // Similar implementations for detectLanguage, healthCheck, estimateCost...
}
```

#### Task 3.4: DeepL Provider
```typescript
// api/src/providers/DeepLProvider.ts
import axios from 'axios';
import { ITranslationProvider, TranslationRequest, TranslationResponse } from '@shared/types/providers';

export class DeepLProvider implements ITranslationProvider {
  name = 'deepl';
  supportedLanguages = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh'];
  maxTokens = 5000;
  costPerToken = 0.00001; // DeepL API pricing
  
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, useFreeApi = false) {
    this.apiKey = apiKey;
    this.baseUrl = useFreeApi ? 
      'https://api-free.deepl.com/v2' : 
      'https://api.deepl.com/v2';
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const startTime = Date.now();
    
    try {
      const response = await axios.post(
        `${this.baseUrl}/translate`,
        {
          text: [request.text],
          target_lang: request.targetLang.toUpperCase(),
          source_lang: request.sourceLang === 'auto' ? null : request.sourceLang.toUpperCase(),
          preserve_formatting: true,
          formality: this.getFormality(request.quality),
          context: request.context,
        },
        {
          headers: {
            'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const translation = response.data.translations[0];
      const charactersUsed = request.text.length;

      return {
        translatedText: translation.text,
        originalText: request.text,
        sourceLang: translation.detected_source_language?.toLowerCase() || request.sourceLang,
        targetLang: request.targetLang,
        confidence: 0.98, // DeepL is highly accurate
        provider: this.name,
        model: 'deepl-api',
        cost: {
          amount: charactersUsed * 0.00002, // Per character pricing
          currency: 'EUR',
          tokensUsed: charactersUsed,
        },
        metadata: {
          translationTimeMs: Date.now() - startTime,
          cacheHit: false,
          requestId: crypto.randomUUID(),
        },
      };
    } catch (error) {
      throw new Error(`DeepL translation failed: ${error.message}`);
    }
  }

  private getFormality(quality?: string): string {
    switch (quality) {
      case 'economy': return 'less';
      case 'premium': return 'more';
      default: return 'default';
    }
  }

  // Additional methods implementation...
}
```

### Intelligent Routing Engine

#### Task 3.5: Smart Translation Router
```typescript
// api/src/services/TranslationRouter.ts
import { ITranslationProvider, TranslationRequest, TranslationResponse } from '@shared/types/providers';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { ClaudeProvider } from '../providers/ClaudeProvider';
import { DeepLProvider } from '../providers/DeepLProvider';

export class TranslationRouter {
  private providers: Map<string, ITranslationProvider> = new Map();
  private providerHealth: Map<string, ProviderHealth> = new Map();
  
  constructor() {
    this.initializeProviders();
    this.startHealthMonitoring();
  }

  private initializeProviders() {
    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider(process.env.OPENAI_API_KEY));
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.set('anthropic', new ClaudeProvider(process.env.ANTHROPIC_API_KEY));
    }
    if (process.env.DEEPL_API_KEY) {
      this.providers.set('deepl', new DeepLProvider(process.env.DEEPL_API_KEY));
    }
  }

  async selectOptimalProvider(request: TranslationRequest): Promise<ITranslationProvider> {
    const languagePair = `${request.sourceLang}-${request.targetLang}`;
    const complexity = this.analyzeComplexity(request.text, request.context);
    
    // Provider selection matrix
    const providerScores = new Map<string, number>();
    
    for (const [name, provider] of this.providers) {
      let score = 0;
      
      // Check if provider supports languages
      if (!this.supportsLanguages(provider, request.sourceLang, request.targetLang)) {
        continue;
      }
      
      // Health score (0-30 points)
      const health = this.providerHealth.get(name);
      if (health?.status === 'healthy') {
        score += 30;
      } else if (health?.status === 'degraded') {
        score += 15;
      }
      
      // Language pair optimization (0-25 points)
      score += this.getLanguagePairScore(name, languagePair);
      
      // Complexity matching (0-25 points)
      score += this.getComplexityScore(name, complexity);
      
      // Cost optimization (0-20 points)
      if (request.quality === 'economy') {
        score += this.getCostScore(name);
      }
      
      providerScores.set(name, score);
    }
    
    // Select provider with highest score
    const bestProvider = Array.from(providerScores.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    if (!bestProvider) {
      throw new Error('No suitable provider available');
    }
    
    return this.providers.get(bestProvider[0])!;
  }

  private analyzeComplexity(text: string, context?: string): 'simple' | 'medium' | 'complex' {
    // Simple: short phrases, common words
    if (text.length < 50 && !context) {
      return 'simple';
    }
    
    // Complex: technical content, long text, with context
    if (text.length > 500 || (context && context.length > 200)) {
      return 'complex';
    }
    
    // Check for technical indicators
    const technicalPatterns = /\b(API|SQL|JSON|function|class|const|let|var)\b/i;
    if (technicalPatterns.test(text)) {
      return 'complex';
    }
    
    return 'medium';
  }

  private getLanguagePairScore(provider: string, languagePair: string): number {
    // DeepL excels at European languages
    if (provider === 'deepl') {
      const europeanPairs = ['en-de', 'de-en', 'en-fr', 'fr-en', 'en-es', 'es-en'];
      if (europeanPairs.includes(languagePair)) {
        return 25;
      }
    }
    
    // Claude handles Asian languages well
    if (provider === 'anthropic') {
      if (languagePair.includes('ja') || languagePair.includes('ko') || languagePair.includes('zh')) {
        return 25;
      }
    }
    
    return 15; // Default score
  }

  private getComplexityScore(provider: string, complexity: string): number {
    const scores = {
      'deepl': { simple: 25, medium: 20, complex: 15 },
      'anthropic': { simple: 15, medium: 20, complex: 25 },
      'openai': { simple: 15, medium: 25, complex: 20 },
    };
    
    return scores[provider]?.[complexity] || 15;
  }

  private getCostScore(provider: string): number {
    const costRanking = {
      'deepl': 20,     // Most economical
      'openai': 10,    // Medium cost
      'anthropic': 5,  // Higher cost
    };
    
    return costRanking[provider] || 10;
  }

  async translateWithFallback(request: TranslationRequest): Promise<TranslationResponse> {
    const primaryProvider = await this.selectOptimalProvider(request);
    
    try {
      return await primaryProvider.translate(request);
    } catch (error) {
      console.error(`Primary provider ${primaryProvider.name} failed:`, error);
      
      // Try fallback providers
      for (const [name, provider] of this.providers) {
        if (provider === primaryProvider) continue;
        
        try {
          console.log(`Trying fallback provider: ${name}`);
          return await provider.translate(request);
        } catch (fallbackError) {
          console.error(`Fallback provider ${name} failed:`, fallbackError);
        }
      }
      
      throw new Error('All translation providers failed');
    }
  }

  private startHealthMonitoring() {
    setInterval(async () => {
      for (const [name, provider] of this.providers) {
        try {
          const health = await provider.healthCheck();
          this.providerHealth.set(name, health);
        } catch (error) {
          this.providerHealth.set(name, {
            status: 'unhealthy',
            available: false,
            error: error.message,
          });
        }
      }
    }, 60000); // Check every minute
  }
}
```

### Context Management System

#### Task 3.6: Context-Aware Translation
```typescript
// api/src/services/ContextManager.ts
export class ContextManager {
  private contextBuffers: Map<string, ConversationContext> = new Map();
  private readonly MAX_CONTEXT_SIZE = 10;
  private readonly MIN_CONTEXT_LENGTH = 100;

  addMessage(channelId: string, message: Message) {
    if (!this.contextBuffers.has(channelId)) {
      this.contextBuffers.set(channelId, {
        messages: [],
        technicalTerms: new Set(),
        participants: new Set(),
      });
    }
    
    const context = this.contextBuffers.get(channelId)!;
    
    // Add message to buffer
    context.messages.push(message);
    
    // Keep only last N messages
    if (context.messages.length > this.MAX_CONTEXT_SIZE) {
      context.messages.shift();
    }
    
    // Extract technical terms
    this.extractTechnicalTerms(message.text, context.technicalTerms);
    
    // Track participants
    context.participants.add(message.userId);
  }

  getContext(channelId: string): string {
    const context = this.contextBuffers.get(channelId);
    if (!context || context.messages.length === 0) {
      return '';
    }
    
    // Build context string
    const contextParts: string[] = [];
    
    // Add recent messages (excluding usernames)
    const recentMessages = context.messages
      .slice(-5)
      .map(m => m.text)
      .join('\n');
    
    if (recentMessages.length >= this.MIN_CONTEXT_LENGTH) {
      contextParts.push(`Recent conversation:\n${recentMessages}`);
    }
    
    // Add technical terms if present
    if (context.technicalTerms.size > 0) {
      contextParts.push(
        `Technical terms used: ${Array.from(context.technicalTerms).join(', ')}`
      );
    }
    
    return contextParts.join('\n\n');
  }

  private extractTechnicalTerms(text: string, terms: Set<string>) {
    // Common technical terms and patterns
    const patterns = [
      /\b[A-Z]{2,}\b/g,              // Acronyms (API, SQL, etc.)
      /\b\w+\(\)/g,                  // Function names
      /\b[a-z]+[A-Z]\w+\b/g,         // camelCase
      /\b[A-Z][a-z]+[A-Z]\w+\b/g,    // PascalCase
      /\b\w+_\w+\b/g,                // snake_case
      /`[^`]+`/g,                    // Code in backticks
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(term => {
          if (term.length > 2 && term.length < 50) {
            terms.add(term);
          }
        });
      }
    }
  }

  clearContext(channelId: string) {
    this.contextBuffers.delete(channelId);
  }

  // Clean up old contexts periodically
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [channelId, context] of this.contextBuffers) {
        const lastMessage = context.messages[context.messages.length - 1];
        if (lastMessage && now - lastMessage.timestamp > 30 * 60 * 1000) {
          // Remove contexts older than 30 minutes
          this.contextBuffers.delete(channelId);
        }
      }
    }, 5 * 60 * 1000); // Clean every 5 minutes
  }
}
```

---

## Week 5-6: Rocket.Chat Plugin Development

### Plugin Core Architecture

#### Task 4.1: Main Plugin Class
```typescript
// plugin/src/UniversalTranslatorApp.ts
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
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class UniversalTranslatorApp extends App implements IPreMessageSentModify {
  private translationService: TranslationService;
  
  constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
    super(info, logger, accessors);
    this.translationService = new TranslationService(logger);
  }

  public async initialize(
    configurationExtend: IConfigurationExtend,
    environmentRead: IEnvironmentRead
  ): Promise<void> {
    // Register settings
    await this.registerSettings(configurationExtend);
    
    // Register slash commands
    await this.registerCommands(configurationExtend);
    
    // Register UI elements
    await this.registerUIElements(configurationExtend);
    
    this.getLogger().info('Universal Translator Pro initialized');
  }

  private async registerSettings(configuration: IConfigurationExtend): Promise<void> {
    await configuration.settings.provideSetting({
      id: 'translation_api_url',
      type: SettingType.STRING,
      packageValue: 'https://translator.noreika.lt',
      required: true,
      public: false,
      i18nLabel: 'Translation_API_URL',
      i18nDescription: 'Translation_API_URL_Description',
    });

    await configuration.settings.provideSetting({
      id: 'api_key',
      type: SettingType.PASSWORD,
      packageValue: '',
      required: false,
      public: false,
      i18nLabel: 'API_Key',
      i18nDescription: 'API_Key_Description',
    });

    await configuration.settings.provideSetting({
      id: 'enable_auto_translation',
      type: SettingType.BOOLEAN,
      packageValue: true,
      required: false,
      public: true,
      i18nLabel: 'Enable_Auto_Translation',
      i18nDescription: 'Enable_Auto_Translation_Description',
    });

    await configuration.settings.provideSetting({
      id: 'default_target_language',
      type: SettingType.SELECT,
      packageValue: 'en',
      values: [
        { key: 'en', i18nLabel: 'English' },
        { key: 'es', i18nLabel: 'Spanish' },
        { key: 'fr', i18nLabel: 'French' },
        { key: 'de', i18nLabel: 'German' },
        { key: 'pt', i18nLabel: 'Portuguese' },
        { key: 'ru', i18nLabel: 'Russian' },
        { key: 'ja', i18nLabel: 'Japanese' },
        { key: 'ko', i18nLabel: 'Korean' },
        { key: 'zh', i18nLabel: 'Chinese' },
      ],
      required: false,
      public: true,
      i18nLabel: 'Default_Target_Language',
      i18nDescription: 'Default_Target_Language_Description',
    });
  }

  // Message interception for real-time translation
  public async executePreMessageSentModify(
    message: IMessage,
    builder: IMessageBuilder,
    read: IRead,
    http: IHttp,
    persistence: IPersistence
  ): Promise<IMessage> {
    // Check if translation is enabled for this channel
    const room = await read.getRoomReader().getById(message.room.id);
    if (!room) return message;
    
    const channelSettings = await this.getChannelSettings(room.id, read);
    if (!channelSettings.translationEnabled) return message;
    
    // Get sender's preferences
    const senderPrefs = await this.getUserPreferences(message.sender.id, read);
    if (!senderPrefs.autoTranslate) return message;
    
    // Store original message for display
    builder.addCustomField('originalText', message.text);
    builder.addCustomField('originalLanguage', senderPrefs.sourceLanguage);
    
    // Mark message as translatable
    builder.addCustomField('isTranslatable', true);
    builder.addCustomField('translationPending', true);
    
    // The actual translation happens in post-message handler
    // to avoid blocking message sending
    return builder.getMessage();
  }

  // Post-message handler for recipient-specific translation
  public async executePostMessageSent(
    message: IMessage,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify
  ): Promise<void> {
    if (!message.customFields?.isTranslatable) return;
    
    const room = await read.getRoomReader().getById(message.room.id);
    if (!room) return;
    
    // Get all room members
    const members = await read.getRoomReader().getMembers(room.id);
    
    // Detect source language if not specified
    const sourceLanguage = message.customFields.originalLanguage || 
      await this.detectLanguage(message.text, http);
    
    // Process translations for each member
    const translationPromises = members
      .filter(member => member.id !== message.sender.id)
      .map(async (member) => {
        const userPrefs = await this.getUserPreferences(member.id, read);
        
        // Skip if user has translation disabled
        if (!userPrefs.enabled) return;
        
        // Skip if message is already in user's language
        if (sourceLanguage === userPrefs.targetLanguage) return;
        
        // Get or create translation
        const translation = await this.getOrCreateTranslation(
          message.text || '',
          sourceLanguage,
          userPrefs.targetLanguage,
          message.room.id,
          http,
          persistence
        );
        
        // Store user-specific translation
        await this.storeUserTranslation(
          message.id,
          member.id,
          translation,
          persistence
        );
      });
    
    await Promise.all(translationPromises);
    
    // Update message to indicate translations are ready
    const messageBuilder = await modify.getUpdater().message(message.id, message.sender);
    messageBuilder.addCustomField('translationPending', false);
    messageBuilder.addCustomField('translationsReady', true);
    await modify.getUpdater().finish(messageBuilder);
  }
}
```

#### Task 4.2: User Preferences Handler
```typescript
// plugin/src/handlers/PreferencesHandler.ts
export class PreferencesHandler {
  constructor(
    private readonly read: IRead,
    private readonly persistence: IPersistence,
    private readonly modify: IModify
  ) {}

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const association = new RocketChatAssociationRecord(
      RocketChatAssociationModel.USER,
      userId
    );
    
    const stored = await this.read.getPersistenceReader().readByAssociation(association);
    
    if (stored && stored.length > 0) {
      return stored[0] as UserPreferences;
    }
    
    // Return default preferences
    return {
      userId,
      enabled: true,
      autoTranslate: true,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      showOriginalOnHover: true,
      qualityTier: 'balanced',
    };
  }

  async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<void> {
    const association = new RocketChatAssociationRecord(
      RocketChatAssociationModel.USER,
      userId
    );
    
    const current = await this.getUserPreferences(userId);
    const updated = { ...current, ...preferences };
    
    await this.persistence.updateByAssociation(
      association,
      updated,
      true // upsert
    );
  }

  async getChannelSettings(channelId: string): Promise<ChannelSettings> {
    const association = new RocketChatAssociationRecord(
      RocketChatAssociationModel.ROOM,
      channelId
    );
    
    const stored = await this.read.getPersistenceReader().readByAssociation(association);
    
    if (stored && stored.length > 0) {
      return stored[0] as ChannelSettings;
    }
    
    return {
      channelId,
      translationEnabled: true,
      allowedUsers: [],
      blockedLanguages: [],
      maxCostPerMessage: 0.01,
    };
  }
}
```

#### Task 4.3: Translation UI Components
```typescript
// plugin/src/ui/TranslationDisplay.tsx
import React, { useState, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { useUserPreferences } from '../hooks/useUserPreferences';

export const TranslationDisplay: React.FC<{ message: IMessage }> = ({ message }) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const { preferences } = useUserPreferences();
  const { getTranslation } = useTranslation();
  
  useEffect(() => {
    if (message.customFields?.isTranslatable && preferences.enabled) {
      loadTranslation();
    }
  }, [message.id, preferences.targetLanguage]);
  
  const loadTranslation = async () => {
    const trans = await getTranslation(
      message.id,
      preferences.targetLanguage
    );
    setTranslation(trans);
  };
  
  const handleHover = (hovering: boolean) => {
    if (preferences.showOriginalOnHover) {
      setShowOriginal(hovering);
    }
  };
  
  const displayText = showOriginal ? 
    message.customFields?.originalText : 
    (translation || message.text);
  
  return (
    <div 
      className="message-content"
      onMouseEnter={() => handleHover(true)}
      onMouseLeave={() => handleHover(false)}
    >
      <span className="message-text">
        {displayText}
      </span>
      {translation && (
        <span className="translation-indicator" title="Translated">
          🌍
        </span>
      )}
      {showOriginal && (
        <div className="original-text-tooltip">
          <small>Original: {message.customFields?.originalText}</small>
        </div>
      )}
    </div>
  );
};
```

#### Task 4.4: Settings Panel Component
```tsx
// plugin/src/ui/SettingsPanel.tsx
import React, { useState, useEffect } from 'react';
import { 
  Select, 
  Switch, 
  Button, 
  Field, 
  FieldGroup 
} from '@rocket.chat/fuselage';

export const TranslationSettings: React.FC = () => {
  const [preferences, setPreferences] = useState<UserPreferences>();
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    loadPreferences();
  }, []);
  
  const loadPreferences = async () => {
    const prefs = await api.getUserPreferences();
    setPreferences(prefs);
  };
  
  const savePreferences = async () => {
    setLoading(true);
    try {
      await api.updateUserPreferences(preferences);
      showSuccess('Preferences saved successfully');
    } catch (error) {
      showError('Failed to save preferences');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <FieldGroup>
      <Field>
        <Field.Label>Enable Translation</Field.Label>
        <Field.Row>
          <Switch
            checked={preferences?.enabled}
            onChange={(e) => setPreferences({
              ...preferences,
              enabled: e.currentTarget.checked
            })}
          />
        </Field.Row>
      </Field>
      
      <Field>
        <Field.Label>Target Language</Field.Label>
        <Field.Row>
          <Select
            value={preferences?.targetLanguage}
            onChange={(value) => setPreferences({
              ...preferences,
              targetLanguage: value
            })}
            options={[
              ['en', 'English'],
              ['es', 'Spanish'],
              ['fr', 'French'],
              ['de', 'German'],
              ['pt', 'Portuguese'],
              ['ru', 'Russian'],
              ['ja', 'Japanese'],
              ['ko', 'Korean'],
              ['zh', 'Chinese'],
            ]}
          />
        </Field.Row>
      </Field>
      
      <Field>
        <Field.Label>Translation Quality</Field.Label>
        <Field.Row>
          <Select
            value={preferences?.qualityTier}
            onChange={(value) => setPreferences({
              ...preferences,
              qualityTier: value
            })}
            options={[
              ['economy', 'Economy (Fast, Lower Quality)'],
              ['balanced', 'Balanced (Default)'],
              ['premium', 'Premium (Best Quality)'],
            ]}
          />
        </Field.Row>
      </Field>
      
      <Field>
        <Field.Label>Show Original on Hover</Field.Label>
        <Field.Row>
          <Switch
            checked={preferences?.showOriginalOnHover}
            onChange={(e) => setPreferences({
              ...preferences,
              showOriginalOnHover: e.currentTarget.checked
            })}
          />
        </Field.Row>
      </Field>
      
      <Field>
        <Button 
          primary 
          onClick={savePreferences}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Preferences'}
        </Button>
      </Field>
    </FieldGroup>
  );
};
```

#### Task 4.5: Admin Dashboard
```tsx
// plugin/src/ui/AdminDashboard.tsx
import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Tabs, 
  Table, 
  Pagination,
  Callout,
  Skeleton
} from '@rocket.chat/fuselage';
import { useAnalytics } from '../hooks/useAnalytics';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const { analytics, loading, error } = useAnalytics();
  
  if (loading) return <Skeleton />;
  if (error) return <Callout type="danger">{error}</Callout>;
  
  return (
    <Box>
      <Tabs>
        <Tabs.Item 
          selected={activeTab === 'overview'} 
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </Tabs.Item>
        <Tabs.Item 
          selected={activeTab === 'usage'} 
          onClick={() => setActiveTab('usage')}
        >
          Usage Analytics
        </Tabs.Item>
        <Tabs.Item 
          selected={activeTab === 'costs'} 
          onClick={() => setActiveTab('costs')}
        >
          Cost Management
        </Tabs.Item>
        <Tabs.Item 
          selected={activeTab === 'settings'} 
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </Tabs.Item>
      </Tabs>
      
      {activeTab === 'overview' && <OverviewPanel analytics={analytics} />}
      {activeTab === 'usage' && <UsagePanel analytics={analytics} />}
      {activeTab === 'costs' && <CostPanel analytics={analytics} />}
      {activeTab === 'settings' && <SettingsPanel />}
    </Box>
  );
};

const OverviewPanel: React.FC<{ analytics: Analytics }> = ({ analytics }) => {
  return (
    <Box>
      <Box.Grid>
        <MetricCard
          title="Total Translations"
          value={analytics.totalTranslations}
          trend={analytics.translationsTrend}
        />
        <MetricCard
          title="Active Users"
          value={analytics.activeUsers}
          trend={analytics.usersTrend}
        />
        <MetricCard
          title="Total Cost"
          value={`€${analytics.totalCost.toFixed(2)}`}
          trend={analytics.costTrend}
        />
        <MetricCard
          title="Cache Hit Rate"
          value={`${(analytics.cacheHitRate * 100).toFixed(1)}%`}
          trend={analytics.cacheHitTrend}
        />
      </Box.Grid>
      
      <Box marginBlock="x16">
        <h3>Top Language Pairs</h3>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Cell>Source</Table.Cell>
              <Table.Cell>Target</Table.Cell>
              <Table.Cell>Count</Table.Cell>
              <Table.Cell>Percentage</Table.Cell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {analytics.topLanguagePairs.map(pair => (
              <Table.Row key={`${pair.source}-${pair.target}`}>
                <Table.Cell>{pair.source}</Table.Cell>
                <Table.Cell>{pair.target}</Table.Cell>
                <Table.Cell>{pair.count}</Table.Cell>
                <Table.Cell>{pair.percentage}%</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Box>
    </Box>
  );
};
```

---

## 📋 Phase 2 Completion Checklist

### Translation Engine ✓
- [ ] OpenAI provider fully integrated
- [ ] Anthropic Claude provider integrated
- [ ] DeepL provider integrated
- [ ] Smart routing engine operational
- [ ] Context management system active
- [ ] Fallback mechanisms tested

### Rocket.Chat Plugin ✓
- [ ] Plugin manifest configured
- [ ] Message interception working
- [ ] User preferences storage
- [ ] Channel settings management
- [ ] Real-time translation flow

### User Interface ✓
- [ ] Translation display component
- [ ] Settings panel functional
- [ ] Admin dashboard created
- [ ] Mobile-responsive design
- [ ] Accessibility standards met

### Integration Points ✓
- [ ] API endpoints connected
- [ ] Authentication working
- [ ] Database operations optimized
- [ ] Caching strategy implemented
- [ ] Error handling complete

---

## 🚀 Ready for Phase 3

With Phase 2 complete, the system is ready for:
- Comprehensive testing
- Performance optimization
- Billing integration
- Security hardening
- Production deployment preparation

---

**Phase Owner**: Backend + Frontend Leads  
**Estimated Completion**: 4 weeks  
**Next Phase**: Integration & Testing (Weeks 7-10)