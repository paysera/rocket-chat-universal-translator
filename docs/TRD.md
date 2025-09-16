# 🔧 Technical Requirements Document (TRD)
# Universal Translator Pro for Rocket.Chat

**Version**: 1.0  
**Date**: 2024-09-12  
**Status**: Draft  

---

## 🏗️ System Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Rocket.Chat   │    │  Context-Aware  │    │   AI Providers  │
│   Apps Plugin   │◄──►│ Translation API │◄──►│   (Multi-AI)    │
│                 │    │translator.noreika│    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │              https://translator     │
         │              .noreika.lt:443        │
         ▼                       │             ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Message Store  │    │PostgreSQL+Redis │    │   Usage/Cost    │
│ (Rocket.Chat DB)│    │ (Dedicated DB)  │    │   Analytics     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Component Architecture

```typescript
// Core System Components
interface SystemComponents {
  plugin: {
    app: UniversalTranslatorApp;
    handlers: {
      messageHandler: MessageHandler;
      settingsHandler: SettingsHandler;
      uiHandler: UIHandler;
    };
    services: {
      translationService: TranslationService;
      userPreferencesService: UserPreferencesService;
      channelConfigService: ChannelConfigService;
    };
  };
  
  standaloneAPI: {
    baseUrl: 'https://translator.noreika.lt';
    authentication: {
      apiKey: 'X-API-Key';
      jwt: 'Bearer token';
    };
    endpoints: {
      translate: '/api/v1/translate';
      detect: '/api/v1/detect';  
      analytics: '/api/v1/analytics';
    };
    routing: {
      smartRouter: SmartTranslationRouter;
      fallbackManager: FallbackManager;
      costOptimizer: CostOptimizer;
    };
    billing: {
      usageTracker: UsageTracker;
      costCalculator: CostCalculator;
      billingManager: BillingManager;
    };
  };
  
  storage: {
    cache: RocketChatCache;           // Use Rocket.Chat's built-in caching system
    database: RocketChatDB;           // Leverage Rocket.Chat's MongoDB instance
    monitoring: PrometheusMetrics;
  };
}
```

---

## 📡 API Specifications

### Translation API Endpoints

#### POST https://translator.noreika.lt/api/v1/translate
**Authentication**: Required (X-API-Key header)

```typescript
interface TranslationRequest {
  text: string;
  target_lang: string;           // Target language code (ISO 639-1)
  source_lang?: string;          // Auto-detect if not provided
  context?: string;              // Conversation context for better translation
  model?: string;                // Specific AI model to use
  quality_tier?: 'economy' | 'balanced' | 'premium';
  max_cost?: number;             // Maximum cost per translation in EUR
}

interface TranslationResponse {
  translated_text: string;
  original_text: string;
  source_lang: string;           // Detected or provided source language
  target_lang: string;
  confidence: number;            // Translation confidence (0-1)
  provider: string;              // AI provider used
  model: string;                 // Specific model used
  cost: {
    amount: number;
    currency: 'EUR';
    tokens_used: number;
  };
  metadata: {
    translation_time_ms: number;
    cache_hit: boolean;
    request_id: string;
  };
}
```

#### POST https://translator.noreika.lt/api/v1/detect  
**Authentication**: Required (X-API-Key header)

```typescript
interface LanguageDetectionRequest {
  text: string;
}

interface LanguageDetectionResponse {
  detected_lang: string;         // ISO 639-1 language code
  confidence: number;            // Detection confidence (0-1)
  model: string;                 // Model used for detection
  alternatives?: Array<{
    lang: string;
    confidence: number;
  }>;
  metadata: {
    detection_time_ms: number;
    request_id: string;
  };
}
```

#### GET https://translator.noreika.lt/api/v1/languages/supported
```typescript
interface SupportedLanguagesResponse {
  languages: {
    code: string;
    name: string;
    nativeName: string;
    providers: string[];
    qualityScore: number;
  }[];
  languagePairs: {
    source: string;
    target: string;
    recommendedProvider: string;
    averageCost: number;
  }[];
}
```

#### POST /api/v1/providers/configure
```typescript
interface ProviderConfigRequest {
  providerId: 'openrouter' | 'anthropic' | 'openai' | 'deepl';
  apiKey: string;
  preferences?: {
    preferredModels?: string[];       // e.g., ['claude-3-sonnet', 'gpt-4', 'mixtral-8x7b']
    contextAwareness?: boolean;       // Enable conversation context for better translations
    maxCostPerRequest?: number;
    timeout?: number;
  };
}
```

### Usage Tracking API

#### GET /api/v1/usage/analytics
```typescript
interface UsageAnalytics {
  timeRange: {
    start: string;
    end: string;
  };
  metrics: {
    totalTranslations: number;
    totalCost: number;
    averageCostPerTranslation: number;
    topLanguagePairs: {
      source: string;
      target: string;
      count: number;
    }[];
    providerUsage: {
      provider: string;
      translationsCount: number;
      successRate: number;
      averageResponseTime: number;
    }[];
  };
  breakdowns: {
    byUser: UserUsage[];
    byChannel: ChannelUsage[];
    byProvider: ProviderUsage[];
  };
}
```

---

## 🗄️ Data Models

### Database Schema (PostgreSQL)

```sql
-- User Preferences
CREATE TABLE user_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL UNIQUE,
  username VARCHAR(100),
  source_language VARCHAR(10) DEFAULT 'auto',
  target_language VARCHAR(10) NOT NULL,
  quality_tier VARCHAR(20) DEFAULT 'balanced',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Channel Configuration  
CREATE TABLE channel_configs (
  id SERIAL PRIMARY KEY,
  channel_id VARCHAR(50) NOT NULL UNIQUE,
  channel_name VARCHAR(100),
  translation_enabled BOOLEAN DEFAULT false,
  allowed_users TEXT[], -- JSON array
  blocked_languages TEXT[], -- JSON array
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Translation History
CREATE TABLE translation_logs (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(50),
  user_id VARCHAR(50),
  channel_id VARCHAR(50),
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang VARCHAR(10),
  target_lang VARCHAR(10),
  provider VARCHAR(50),
  model VARCHAR(100),
  cost_amount DECIMAL(10,6),
  cost_currency VARCHAR(3) DEFAULT 'EUR',
  tokens_used INTEGER,
  response_time_ms INTEGER,
  confidence DECIMAL(5,4),
  created_at TIMESTAMP DEFAULT NOW()
);

-- API Provider Configurations
CREATE TABLE provider_configs (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50),
  provider_id VARCHAR(50),
  api_key_encrypted TEXT,
  preferences JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, provider_id)
);

-- Usage Analytics
CREATE TABLE usage_analytics (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50),
  date DATE NOT NULL,
  total_translations INTEGER DEFAULT 0,
  total_cost DECIMAL(10,4) DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  metrics JSONB, -- Detailed breakdown
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, date)
);
```

### Rocket.Chat Cache Integration

```typescript
// Leverage Rocket.Chat's built-in caching mechanisms
interface RocketChatCacheStructure {
  // Use Rocket.Chat's cache system instead of separate Redis
  cache: {
    provider: 'RocketChat.cache';           // Built-in cache service
    storage: 'MongoDB' | 'Memory';          // Configurable storage backend
    clustering: 'automatic';               // Handles multi-instance sync
  };
  
  // Cache Keys adapted to Rocket.Chat naming conventions
  keys: {
    translation: `universal-translator:translation:${md5(text+sourceLang+targetLang)}`;
    userPrefs: `universal-translator:user:${userId}:preferences`;
    channelConfig: `universal-translator:channel:${channelId}:config`;
    providerHealth: `universal-translator:provider:${providerId}:health`;
    contextBuffer: `universal-translator:context:${channelId}:buffer`;
  };
  
  // TTL values optimized for chat context
  expiry: {
    translation: 24 * 60 * 60;     // 24 hours - conversations repeat
    userPrefs: 12 * 60 * 60;       // 12 hours - settings change rarely  
    channelConfig: 6 * 60 * 60;     // 6 hours - channel settings
    providerHealth: 5 * 60;         // 5 minutes - quick health checks
    contextBuffer: 30 * 60;         // 30 minutes - conversation context
  };
}

// Context-Aware Caching Strategy
interface ContextAwareCaching {
  conversationContext: {
    // Store recent messages for context in AI translation
    bufferSize: 5;                  // Last 5 messages for context
    includeUsernames: true;         // Help AI understand who is talking
    technicalTerms: string[];       // Cache domain-specific terms
  };
  
  smartCacheKeys: {
    // Context-aware cache key generation
    withContext: `translation:${md5(text+context+sourceLang+targetLang)}`;
    withoutContext: `translation:${md5(text+sourceLang+targetLang)}`;
    
    // Prefer context-aware translations
    priority: 'context_aware_first';
  };
}
```

---

## 🔐 Security Requirements

### Authentication & Authorization

```typescript
interface SecurityModel {
  authentication: {
    method: 'rocket_chat_token';
    validation: 'per_request';
    expiry: 'session_based';
  };
  
  authorization: {
    levels: {
      user: ['read_preferences', 'update_preferences', 'translate_messages'];
      admin: ['configure_providers', 'manage_channels', 'view_analytics'];
      owner: ['billing_management', 'workspace_settings'];
    };
    
    channelPermissions: {
      public: 'all_users_with_translation_enabled';
      private: 'channel_members_only';
      direct: 'conversation_participants_only';
    };
  };
  
  dataProtection: {
    encryption: {
      atRest: 'AES-256';
      inTransit: 'TLS-1.3';
      apiKeys: 'AES-256+unique_salt_per_workspace';
    };
    
    privacy: {
      messageRetention: '30_days_max';
      personalDataAccess: 'user_controlled';
      dataExport: 'gdpr_compliant';
      dataDeletion: 'automatic_on_user_request';
    };
  };
}
```

### API Key Management

```typescript
interface ApiKeySecurity {
  encryption: {
    algorithm: 'AES-256-GCM';
    keyDerivation: 'PBKDF2';
    saltGeneration: 'crypto.randomBytes(32)';
  };
  
  storage: {
    location: 'database_encrypted_field';
    access: 'admin_only';
    rotation: 'manual_or_scheduled';
  };
  
  validation: {
    testCall: 'minimal_cost_test_translation';
    healthCheck: 'every_5_minutes';
    errorHandling: 'fallback_to_next_provider';
  };
}
```

---

## ⚡ Performance Requirements

### Response Time Targets

```typescript
interface PerformanceTargets {
  translation: {
    realtime: {
      target: '<2_seconds';
      p95: '<3_seconds';
      p99: '<5_seconds';
    };
    
    batch: {
      target: '<10_seconds_per_100_messages';
      throughput: '50_translations_per_second';
    };
  };
  
  caching: {
    hitRate: '>80%';
    responseTime: '<50ms';
    evictionPolicy: 'LRU_with_TTL';
  };
  
  api: {
    uptime: '99.9%';
    concurrentUsers: '1000+';
    rateLimiting: '100_requests_per_minute_per_user';
  };
}
```

### Scalability Architecture

```typescript
interface ScalabilityDesign {
  horizontal: {
    translationApi: {
      loadBalancer: 'nginx_or_cloudflare';
      instances: 'auto_scaling_2_to_20';
      database: 'read_replicas';
    };
    
    cache: {
      redis: 'cluster_mode_3_nodes';
      fallback: 'database_query';
    };
  };
  
  vertical: {
    cpuOptimization: 'async_processing';
    memoryOptimization: 'connection_pooling';
    ioOptimization: 'batch_database_operations';
  };
  
  monitoring: {
    metrics: 'prometheus_grafana';
    alerting: 'error_rate_above_5%_or_latency_above_5s';
    logging: 'structured_json_logs';
  };
}
```

---

## 🔌 Integration Patterns

### Rocket.Chat Apps Framework Integration

```typescript
// Main App Class
export class UniversalTranslatorApp extends App implements IPreMessageSentModify {
  
  constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
    super(info, logger, accessors);
  }

  // Message Interception
  async executePreMessageSentModify(
    message: IMessage,
    builder: IMessageBuilder,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify
  ): Promise<IMessage> {
    
    // Check if user has translation enabled
    const userPrefs = await this.getUserPreferences(message.sender.id);
    if (!userPrefs.enabled) return message;
    
    // Check for language prefix
    const { targetLang, cleanText } = this.parseLanguagePrefix(message.text);
    if (!targetLang && !userPrefs.autoTranslate) return message;
    
    // Perform translation
    const translatedText = await this.translateMessage({
      text: cleanText || message.text,
      sourceLang: userPrefs.sourceLang,
      targetLang: targetLang || userPrefs.targetLang,
      context: await this.getConversationContext(message.room.id),
    });
    
    // Modify message
    builder.setText(translatedText);
    builder.addCustomField('originalText', message.text);
    builder.addCustomField('translatedBy', 'universal-translator-pro');
    
    return builder.getMessage();
  }
  
  // Display Translation for Readers
  async executePostMessageSent(
    message: IMessage,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify
  ): Promise<void> {
    
    // Get all users in room
    const roomUsers = await read.getRoomReader().getMembers(message.room.id);
    
    for (const user of roomUsers) {
      if (user.id === message.sender.id) continue;
      
      const userPrefs = await this.getUserPreferences(user.id);
      if (!userPrefs.enabled) continue;
      
      // Check if message needs translation for this user
      const messageLang = await this.detectLanguage(message.text);
      if (messageLang === userPrefs.targetLang) continue;
      
      // Send personalized translated message
      await this.sendPersonalizedTranslation(message, user, userPrefs);
    }
  }
}
```

### AI Provider Integration Pattern

```typescript
// Abstract Provider Interface
interface AIProvider {
  name: string;
  supportedLanguages: string[];
  costPerToken: number;
  
  translate(request: TranslationRequest): Promise<TranslationResponse>;
  healthCheck(): Promise<boolean>;
  estimateCost(text: string): Promise<number>;
}

// Context-Aware AI Router Implementation
class ContextAwareTranslationRouter {
  private aiProviders: Map<string, AIProvider> = new Map();
  
  async selectOptimalAI(request: TranslationRequest): Promise<AIProvider> {
    const languagePair = `${request.sourceLang}-${request.targetLang}`;
    
    // Analyze text complexity for AI model selection
    const complexity = this.analyzeTextComplexity(request.text, request.context);
    
    // Select AI model based on context needs
    const optimalProvider = this.selectAIByContext({
      complexity,
      languagePair,
      hasContext: !!request.context?.conversationHistory,
      textType: request.context?.messageType,
      budget: request.userPreferences.maxCostPerTranslation
    });
    
    return optimalProvider;
  }
  
  private analyzeTextComplexity(text: string, context: any): 'simple' | 'medium' | 'complex' {
    // Simple: "hello", "yes", "ok" 
    if (text.length < 20 && !/[.!?]/.test(text)) return 'simple';
    
    // Complex: technical terms, business context, multiple sentences
    if (context?.messageType === 'technical' || text.length > 200) return 'complex';
    
    return 'medium';
  }
  
  private selectAIByContext(params: any): AIProvider {
    // For simple translations: use fastest/cheapest AI
    if (params.complexity === 'simple') {
      return this.aiProviders.get('openrouter-mixtral');  // Fast & cheap
    }
    
    // For complex context: use best AI models
    if (params.complexity === 'complex' || params.hasContext) {
      return this.aiProviders.get('anthropic-claude-3-sonnet'); // Best context understanding
    }
    
    // For medium complexity: balanced option
    return this.aiProviders.get('openrouter-gpt-4o-mini'); // Good balance
  }
  
  async translateWithFallback(request: TranslationRequest): Promise<TranslationResponse> {
    const providers = await this.getPrioritizedProviders(request);
    
    for (const provider of providers) {
      try {
        const result = await provider.translate(request);
        if (result.confidence >= 0.8) return result;
      } catch (error) {
        this.logger.warn(`Provider ${provider.name} failed:`, error);
        continue;
      }
    }
    
    throw new Error('All providers failed');
  }
}
```

---

## 📊 Monitoring & Analytics

### Metrics Collection

```typescript
interface MetricsCollection {
  business: {
    translations_per_minute: Counter;
    unique_users_daily: Gauge;
    revenue_per_workspace: Counter;
    churn_rate_monthly: Gauge;
  };
  
  technical: {
    api_response_time: Histogram;
    provider_success_rate: Gauge;
    cache_hit_rate: Gauge;
    error_rate: Counter;
  };
  
  cost: {
    provider_costs_per_translation: Histogram;
    markup_revenue: Counter;
    cost_optimization_savings: Counter;
  };
}
```

### Health Checks

```typescript
interface HealthChecks {
  translation_api: {
    endpoint: '/health';
    checks: ['database', 'redis', 'ai_providers'];
    timeout: 5000;
    interval: 30000;
  };
  
  ai_providers: {
    checks: provider => ({
      name: provider.name,
      status: 'healthy' | 'degraded' | 'unhealthy',
      latency: number,
      lastError?: string,
    });
    interval: 300000; // 5 minutes
  };
  
  plugin: {
    checks: ['rocket_chat_connection', 'user_preferences', 'message_processing'];
    failureThreshold: 3;
    recoveryTime: 60000;
  };
}
```

---

## 🚀 Deployment Strategy

### Development Environment

```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  rocket-chat:
    image: rocketchat/rocket.chat:6.4.0
    ports:
      - "3000:3000"
    environment:
      - ROOT_URL=http://localhost:3000
      - MONGO_URL=mongodb://mongo:27017/rocketchat
      - ADMIN_USERNAME=admin
      - ADMIN_PASS=admin123
      - ADMIN_EMAIL=admin@test.com
    depends_on:
      - mongo
    volumes:
      - ./plugin:/app/uploads  # Plugin development directory
      
  mongo:
    image: mongo:5.0
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    command: --replSet rs0 --keyFile /data/replica.key
    
  # Translation API runs separately at translator.noreika.lt
  # No local translation service needed for development

volumes:
  mongo_data:
```

### Production Deployment

```typescript
interface ProductionDeployment {
  plugin: {
    marketplace: 'Rocket.Chat Apps Marketplace';
    distribution: 'Automated via Apps CLI';
    updates: 'Marketplace auto-update system';
    version_control: 'GitHub releases → marketplace';
  };
  
  translationAPI: {
    endpoint: 'https://translator.noreika.lt';
    deployment: '/opt/prod/services/context-aware-translator/';
    infrastructure: 'Docker Compose + Nginx + PostgreSQL + Redis';
    ssl: 'Let\'s Encrypt + Nginx reverse proxy';
    monitoring: 'Built-in health checks + log aggregation';
  };
  
  billing: {
    primary: 'Rocket.Chat Marketplace billing integration';
    fallback: 'Direct API key registration at translator.noreika.lt';
    model: 'Freemium (3 EUR included) → pay-as-you-go';
    currency: 'EUR';
  };
  
  cicd: {
    plugin: 'GitHub Actions → rc-apps deploy';
    api: 'Git push → Docker rebuild → health check';
    rollback: 'Marketplace version rollback + API deployment rollback';
  };
}
```

---

## 🧪 Testing Strategy

### Testing Pyramid

```typescript
interface TestingStrategy {
  unit: {
    coverage: '>90%';
    tools: ['Jest', 'pytest'];
    focus: ['translation_logic', 'user_preferences', 'cost_calculation'];
  };
  
  integration: {
    coverage: '>80%';
    tools: ['Supertest', 'pytest-asyncio'];
    focus: ['api_endpoints', 'database_operations', 'provider_integration'];
  };
  
  e2e: {
    coverage: 'critical_user_journeys';
    tools: ['Playwright', 'Cypress'];
    focus: ['message_translation_flow', 'settings_configuration'];
  };
  
  performance: {
    tools: ['k6', 'Artillery'];
    scenarios: ['load_testing', 'spike_testing', 'stress_testing'];
    targets: {
      rps: 100,
      latency_p95: '<3s',
      error_rate: '<1%'
    };
  };
}
```

---

## 📋 Technical Acceptance Criteria

### Core Functionality
- ✅ Message interception and modification works in real-time
- ✅ Multi-provider AI integration with automatic fallback
- ✅ Individual user preferences persist and apply correctly
- ✅ Translation accuracy >85% for supported language pairs
- ✅ Response time <2 seconds for 95% of requests

### Security & Privacy
- ✅ API keys encrypted at rest with unique salts
- ✅ User messages not stored beyond 30-day retention
- ✅ GDPR-compliant data export and deletion
- ✅ Rate limiting prevents abuse

### Scalability & Performance  
- ✅ System handles 1000+ concurrent users
- ✅ Cache hit rate >80% for repeated translations
- ✅ Database queries optimized with proper indexing
- ✅ API responds within SLA 99.9% of time

### Administration & Monitoring
- ✅ Comprehensive admin dashboard with analytics
- ✅ Usage tracking accurate within 1% margin
- ✅ Cost calculation matches provider billing
- ✅ Health monitoring alerts within 1 minute of issues

---

**Document Owner**: Engineering Team  
**Review Cycle**: Weekly during development  
**Last Updated**: 2024-09-12  
**Next Review**: 2024-09-19