import { BaseProvider } from '../providers/base';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { ClaudeProvider } from '../providers/ClaudeProvider';
import { DeepLProvider } from '../providers/DeepLProvider';
import { TranslationRequest, TranslationResponse } from '../providers/base';
import { pool } from '../config/database';
import { cache } from '../config/redis';
import { log } from '../utils/logger';

interface ProviderConfig {
  provider: BaseProvider;
  priority: number;
  costPerChar: number;
  qualityScore: number;
  languageSupport: string[] | 'all';
  maxLoad: number;
  currentLoad: number;
  healthy: boolean;
  lastHealthCheck: Date;
}

interface RoutingStrategy {
  strategy: 'cost' | 'quality' | 'speed' | 'balanced';
  maxCostPerTranslation?: number;
  minQualityScore?: number;
  maxResponseTime?: number;
}

export class IntelligentRouter {
  private providers: Map<string, ProviderConfig> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;

  constructor() {
    this.setupProviders();
  }

  private setupProviders() {
    // OpenAI Provider
    this.providers.set('openai', {
      provider: new OpenAIProvider(),
      priority: 2,
      costPerChar: 0.00002, // $20 per million chars
      qualityScore: 0.92,
      languageSupport: 'all',
      maxLoad: 100,
      currentLoad: 0,
      healthy: true,
      lastHealthCheck: new Date()
    });

    // Claude Provider
    this.providers.set('claude', {
      provider: new ClaudeProvider(),
      priority: 1,
      costPerChar: 0.00003, // $30 per million chars
      qualityScore: 0.95,
      languageSupport: 'all',
      maxLoad: 50,
      currentLoad: 0,
      healthy: true,
      lastHealthCheck: new Date()
    });

    // DeepL Provider
    this.providers.set('deepl', {
      provider: new DeepLProvider(),
      priority: 3,
      costPerChar: 0.000025, // $25 per million chars
      qualityScore: 0.98,
      languageSupport: [
        'en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ru',
        'ja', 'zh', 'bg', 'cs', 'da', 'el', 'et', 'fi', 'hu',
        'lt', 'lv', 'ro', 'sk', 'sl', 'sv'
      ],
      maxLoad: 200,
      currentLoad: 0,
      healthy: true,
      lastHealthCheck: new Date()
    });
  }

  async initialize(workspaceId: string) {
    try {
      // Load provider configurations from database
      const result = await pool.query(
        `SELECT * FROM provider_configs 
         WHERE workspace_id = $1 AND is_active = true`,
        [workspaceId]
      );

      for (const row of result.rows) {
        const config = this.providers.get(row.provider_id);
        if (config && row.api_key_encrypted) {
          // Initialize provider with decrypted API key
          // Note: Implement decryption in production
          await config.provider.initialize(row.api_key_encrypted);
        }
      }

      // Start health monitoring
      this.startHealthMonitoring();
      this.initialized = true;

      log.info('Intelligent router initialized', {
        workspaceId,
        activeProviders: Array.from(this.providers.keys()).filter(
          k => this.providers.get(k)?.healthy
        )
      });
    } catch (error) {
      log.error('Failed to initialize router', error);
      throw error;
    }
  }

  async selectProvider(
    request: TranslationRequest,
    strategy: RoutingStrategy = { strategy: 'balanced' }
  ): Promise<string> {
    const availableProviders = this.getAvailableProviders(request);
    
    if (availableProviders.length === 0) {
      throw new Error('No available providers for this translation');
    }

    // Sort providers based on strategy
    const sortedProviders = this.sortProvidersByStrategy(
      availableProviders,
      strategy,
      request
    );

    // Select the best provider
    const selectedProvider = sortedProviders[0];
    
    // Update load
    selectedProvider.currentLoad++;
    
    log.info('Provider selected', {
      provider: selectedProvider.provider.name,
      strategy: strategy.strategy,
      cost: selectedProvider.costPerChar * request.text.length,
      quality: selectedProvider.qualityScore
    });

    return selectedProvider.provider.name;
  }

  private getAvailableProviders(request: TranslationRequest): ProviderConfig[] {
    const available: ProviderConfig[] = [];

    for (const [name, config] of this.providers) {
      // Check if provider is healthy
      if (!config.healthy) continue;

      // Check language support
      if (config.languageSupport !== 'all') {
        const langs = config.languageSupport as string[];
        if (!langs.includes(request.targetLang)) continue;
        if (request.sourceLang !== 'auto' && !langs.includes(request.sourceLang)) continue;
      }

      // Check load capacity
      if (config.currentLoad >= config.maxLoad) continue;

      // Check if provider is initialized
      if (!config.provider.isInitialized()) continue;

      available.push(config);
    }

    return available;
  }

  private sortProvidersByStrategy(
    providers: ProviderConfig[],
    strategy: RoutingStrategy,
    request: TranslationRequest
  ): ProviderConfig[] {
    const textLength = request.text.length;

    switch (strategy.strategy) {
      case 'cost':
        // Sort by cost (lowest first)
        return providers.sort((a, b) => {
          const costA = a.costPerChar * textLength;
          const costB = b.costPerChar * textLength;
          return costA - costB;
        });

      case 'quality':
        // Sort by quality score (highest first)
        return providers.sort((a, b) => b.qualityScore - a.qualityScore);

      case 'speed':
        // Sort by current load (lowest first) and priority
        return providers.sort((a, b) => {
          const loadDiff = a.currentLoad - b.currentLoad;
          if (loadDiff !== 0) return loadDiff;
          return a.priority - b.priority;
        });

      case 'balanced':
      default:
        // Balanced scoring: quality * 0.4 + speed * 0.3 + cost * 0.3
        return providers.sort((a, b) => {
          const scoreA = this.calculateBalancedScore(a, textLength);
          const scoreB = this.calculateBalancedScore(b, textLength);
          return scoreB - scoreA; // Higher score is better
        });
    }
  }

  private calculateBalancedScore(config: ProviderConfig, textLength: number): number {
    // Quality component (0-1, higher is better)
    const qualityScore = config.qualityScore * 0.4;

    // Speed component (0-1, lower load is better)
    const loadRatio = config.currentLoad / config.maxLoad;
    const speedScore = (1 - loadRatio) * 0.3;

    // Cost component (0-1, lower cost is better)
    const maxCost = 0.00005; // Maximum expected cost per char
    const costRatio = config.costPerChar / maxCost;
    const costScore = (1 - costRatio) * 0.3;

    return qualityScore + speedScore + costScore;
  }

  async translate(
    request: TranslationRequest,
    strategy: RoutingStrategy = { strategy: 'balanced' }
  ): Promise<TranslationResponse> {
    if (!this.initialized) {
      throw new Error('Router not initialized');
    }

    const providerName = await this.selectProvider(request, strategy);
    const config = this.providers.get(providerName);
    
    if (!config) {
      throw new Error(`Provider ${providerName} not found`);
    }

    try {
      // Attempt translation
      const response = await config.provider.translate(request);
      
      // Update load
      config.currentLoad = Math.max(0, config.currentLoad - 1);
      
      // Track success
      await this.trackUsage(providerName, request, response, true);
      
      return response;
    } catch (error) {
      // Update load
      config.currentLoad = Math.max(0, config.currentLoad - 1);
      
      // Mark provider as unhealthy if too many failures
      await this.handleProviderError(providerName, error);
      
      // Try fallback provider
      return this.translateWithFallback(request, strategy, [providerName]);
    }
  }

  private async translateWithFallback(
    request: TranslationRequest,
    strategy: RoutingStrategy,
    failedProviders: string[]
  ): Promise<TranslationResponse> {
    // Get available providers excluding failed ones
    const availableProviders = this.getAvailableProviders(request)
      .filter(p => !failedProviders.includes(p.provider.name));

    if (availableProviders.length === 0) {
      throw new Error('All translation providers failed');
    }

    // Sort by priority for fallback
    const sortedProviders = availableProviders.sort((a, b) => a.priority - b.priority);
    
    for (const config of sortedProviders) {
      try {
        config.currentLoad++;
        const response = await config.provider.translate(request);
        config.currentLoad = Math.max(0, config.currentLoad - 1);
        
        await this.trackUsage(config.provider.name, request, response, true);
        
        log.info('Fallback translation successful', {
          provider: config.provider.name,
          failedProviders
        });
        
        return response;
      } catch (error) {
        config.currentLoad = Math.max(0, config.currentLoad - 1);
        failedProviders.push(config.provider.name);
        log.error(`Fallback provider ${config.provider.name} failed`, error);
      }
    }

    throw new Error('All fallback providers failed');
  }

  private async handleProviderError(providerName: string, error: any) {
    const config = this.providers.get(providerName);
    if (!config) return;

    // Increment error count (implement proper error tracking)
    log.error(`Provider ${providerName} error`, error);

    // Mark as unhealthy if too many errors
    // This is simplified - implement proper error threshold tracking
    const errorThreshold = 5;
    const recentErrors = 1; // Track this properly
    
    if (recentErrors >= errorThreshold) {
      config.healthy = false;
      log.warn(`Provider ${providerName} marked as unhealthy`);
    }
  }

  private async trackUsage(
    providerName: string,
    request: TranslationRequest,
    response: TranslationResponse,
    success: boolean
  ) {
    try {
      // Cache provider performance metrics
      const metricsKey = `provider:${providerName}:metrics`;
      const metrics = await cache.get(metricsKey) || {
        totalRequests: 0,
        successfulRequests: 0,
        totalResponseTime: 0,
        totalCost: 0
      };

      metrics.totalRequests++;
      if (success) {
        metrics.successfulRequests++;
        metrics.totalResponseTime += response.processingTime;
        metrics.totalCost += response.cost || 0;
      }

      await cache.set(metricsKey, metrics, 3600); // Cache for 1 hour
    } catch (error) {
      log.error('Failed to track usage', error);
    }
  }

  private startHealthMonitoring() {
    // Check provider health every 60 seconds
    this.healthCheckInterval = setInterval(async () => {
      for (const [name, config] of this.providers) {
        try {
          const healthy = await config.provider.checkHealth();
          
          if (healthy && !config.healthy) {
            log.info(`Provider ${name} recovered`);
          } else if (!healthy && config.healthy) {
            log.warn(`Provider ${name} became unhealthy`);
          }
          
          config.healthy = healthy;
          config.lastHealthCheck = new Date();
        } catch (error) {
          log.error(`Health check failed for ${name}`, error);
          config.healthy = false;
        }
      }
    }, 60000);
  }

  async getProviderStats(): Promise<any> {
    const stats: any = {};
    
    for (const [name, config] of this.providers) {
      const metricsKey = `provider:${name}:metrics`;
      const metrics = await cache.get(metricsKey) || {};
      
      stats[name] = {
        healthy: config.healthy,
        currentLoad: config.currentLoad,
        maxLoad: config.maxLoad,
        qualityScore: config.qualityScore,
        costPerChar: config.costPerChar,
        lastHealthCheck: config.lastHealthCheck,
        metrics
      };
    }
    
    return stats;
  }

  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}