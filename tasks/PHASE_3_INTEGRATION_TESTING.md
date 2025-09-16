# 🧪 Phase 3: Integration & Testing Tasks
**Duration**: Weeks 7-10  
**Priority**: Critical Path  
**Team**: QA + DevOps + Full Stack

---

## Week 7-8: Advanced Features & Integration

### Billing System Integration

#### Task 5.1: Rocket.Chat Marketplace Billing API
```typescript
// api/src/services/BillingService.ts
import { EventEmitter } from 'events';

export class BillingService extends EventEmitter {
  private readonly FREEMIUM_CREDITS = 3.00; // EUR
  private workspaceCredits: Map<string, WorkspaceCredits> = new Map();
  
  async initializeWorkspace(workspaceId: string): Promise<void> {
    // Check if workspace exists
    const existing = await this.getWorkspaceCredits(workspaceId);
    if (existing) return;
    
    // Initialize with freemium credits
    const credits: WorkspaceCredits = {
      workspaceId,
      balance: this.FREEMIUM_CREDITS,
      currency: 'EUR',
      plan: 'freemium',
      autoRecharge: false,
      rechargeThreshold: 1.00,
      rechargeAmount: 10.00,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await this.saveWorkspaceCredits(credits);
    this.workspaceCredits.set(workspaceId, credits);
  }
  
  async checkBalance(workspaceId: string, estimatedCost: number): Promise<boolean> {
    const credits = await this.getWorkspaceCredits(workspaceId);
    
    if (!credits) {
      await this.initializeWorkspace(workspaceId);
      return estimatedCost <= this.FREEMIUM_CREDITS;
    }
    
    return credits.balance >= estimatedCost;
  }
  
  async deductCredits(
    workspaceId: string, 
    amount: number, 
    description: string
  ): Promise<TransactionResult> {
    const credits = await this.getWorkspaceCredits(workspaceId);
    
    if (!credits || credits.balance < amount) {
      // Trigger auto-recharge if enabled
      if (credits?.autoRecharge) {
        await this.rechargeCredits(workspaceId, credits.rechargeAmount);
        return this.deductCredits(workspaceId, amount, description);
      }
      
      throw new InsufficientCreditsError(
        `Insufficient credits. Current balance: €${credits?.balance || 0}`
      );
    }
    
    // Create transaction
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      workspaceId,
      type: 'debit',
      amount,
      balanceBefore: credits.balance,
      balanceAfter: credits.balance - amount,
      description,
      createdAt: new Date(),
    };
    
    // Update balance
    credits.balance -= amount;
    credits.updatedAt = new Date();
    
    await this.saveWorkspaceCredits(credits);
    await this.saveTransaction(transaction);
    
    // Check if recharge needed
    if (credits.autoRecharge && credits.balance < credits.rechargeThreshold) {
      this.emit('lowBalance', { workspaceId, balance: credits.balance });
      await this.rechargeCredits(workspaceId, credits.rechargeAmount);
    }
    
    return {
      success: true,
      transaction,
      newBalance: credits.balance,
    };
  }
  
  async rechargeCredits(workspaceId: string, amount: number): Promise<void> {
    // Integration with Rocket.Chat Marketplace billing
    try {
      const response = await this.marketplaceBilling.charge({
        workspaceId,
        amount,
        currency: 'EUR',
        description: 'Universal Translator Pro - Credit Recharge',
      });
      
      if (response.success) {
        const credits = await this.getWorkspaceCredits(workspaceId);
        credits.balance += amount;
        credits.updatedAt = new Date();
        
        await this.saveWorkspaceCredits(credits);
        
        const transaction: Transaction = {
          id: crypto.randomUUID(),
          workspaceId,
          type: 'credit',
          amount,
          balanceBefore: credits.balance - amount,
          balanceAfter: credits.balance,
          description: 'Credit recharge via Marketplace',
          paymentId: response.paymentId,
          createdAt: new Date(),
        };
        
        await this.saveTransaction(transaction);
        this.emit('creditsRecharged', { workspaceId, amount, newBalance: credits.balance });
      }
    } catch (error) {
      this.emit('rechargeError', { workspaceId, amount, error: error.message });
      throw error;
    }
  }
}
```

#### Task 5.2: Usage Tracking Implementation
```typescript
// api/src/services/UsageTracker.ts
export class UsageTracker {
  private readonly batchSize = 100;
  private usageQueue: UsageRecord[] = [];
  private flushInterval: NodeJS.Timeout;
  
  constructor(
    private db: Database,
    private billingService: BillingService
  ) {
    this.startBatchProcessor();
  }
  
  async trackUsage(record: UsageRecord): Promise<void> {
    // Add to queue
    this.usageQueue.push(record);
    
    // Process immediately if batch is full
    if (this.usageQueue.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async trackTranslation(params: {
    workspaceId: string;
    userId: string;
    channelId: string;
    messageId: string;
    text: string;
    translatedText: string;
    sourceLang: string;
    targetLang: string;
    provider: string;
    model: string;
    tokensUsed: number;
    cost: number;
    responseTimeMs: number;
    cacheHit: boolean;
  }): Promise<void> {
    const record: UsageRecord = {
      ...params,
      characters: params.text.length,
      timestamp: new Date(),
    };
    
    await this.trackUsage(record);
    
    // Deduct credits if not cached
    if (!params.cacheHit) {
      try {
        await this.billingService.deductCredits(
          params.workspaceId,
          params.cost,
          `Translation: ${params.sourceLang} → ${params.targetLang}`
        );
      } catch (error) {
        // Log error but don't fail translation
        console.error('Failed to deduct credits:', error);
        // Could implement grace period or notification system
      }
    }
  }
  
  private async flush(): Promise<void> {
    if (this.usageQueue.length === 0) return;
    
    const records = [...this.usageQueue];
    this.usageQueue = [];
    
    try {
      // Batch insert to database
      await this.db.batchInsert('usage_tracking', records);
      
      // Update daily analytics
      await this.updateAnalytics(records);
    } catch (error) {
      console.error('Failed to flush usage records:', error);
      // Re-queue failed records
      this.usageQueue.unshift(...records);
    }
  }
  
  private async updateAnalytics(records: UsageRecord[]): Promise<void> {
    // Group by workspace and date
    const grouped = new Map<string, DailyAnalytics>();
    
    for (const record of records) {
      const date = record.timestamp.toISOString().split('T')[0];
      const key = `${record.workspaceId}:${date}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          workspaceId: record.workspaceId,
          date,
          totalTranslations: 0,
          totalCost: 0,
          uniqueUsers: new Set(),
          cacheHits: 0,
          totalResponseTime: 0,
          languagePairs: new Map(),
          providerUsage: new Map(),
        });
      }
      
      const analytics = grouped.get(key)!;
      analytics.totalTranslations++;
      analytics.totalCost += record.cost;
      analytics.uniqueUsers.add(record.userId);
      
      if (record.cacheHit) {
        analytics.cacheHits++;
      }
      
      analytics.totalResponseTime += record.responseTimeMs;
      
      // Track language pairs
      const langPair = `${record.sourceLang}-${record.targetLang}`;
      analytics.languagePairs.set(
        langPair,
        (analytics.languagePairs.get(langPair) || 0) + 1
      );
      
      // Track provider usage
      analytics.providerUsage.set(
        record.provider,
        (analytics.providerUsage.get(record.provider) || 0) + 1
      );
    }
    
    // Save to database
    for (const analytics of grouped.values()) {
      await this.saveAnalytics(analytics);
    }
  }
  
  private startBatchProcessor(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, 5000); // Flush every 5 seconds
  }
  
  async getUsageReport(workspaceId: string, period: 'day' | 'week' | 'month'): Promise<UsageReport> {
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }
    
    const analytics = await this.db.query(`
      SELECT 
        SUM(total_translations) as totalTranslations,
        SUM(total_cost) as totalCost,
        SUM(cache_hits) as cacheHits,
        AVG(avg_response_time_ms) as avgResponseTime,
        COUNT(DISTINCT date) as days
      FROM analytics_daily
      WHERE workspace_id = $1 
        AND date >= $2 
        AND date <= $3
    `, [workspaceId, startDate, endDate]);
    
    const topUsers = await this.db.query(`
      SELECT 
        user_id,
        COUNT(*) as translationCount,
        SUM(cost_amount) as totalCost
      FROM usage_tracking
      WHERE workspace_id = $1 
        AND created_at >= $2 
        AND created_at <= $3
      GROUP BY user_id
      ORDER BY translationCount DESC
      LIMIT 10
    `, [workspaceId, startDate, endDate]);
    
    return {
      period,
      startDate,
      endDate,
      summary: analytics.rows[0],
      topUsers: topUsers.rows,
      cacheHitRate: analytics.rows[0].cacheHits / analytics.rows[0].totalTranslations,
    };
  }
}
```

### Performance Optimization

#### Task 5.3: Database Query Optimization
```typescript
// api/src/optimization/DatabaseOptimizer.ts
export class DatabaseOptimizer {
  async createIndexes(): Promise<void> {
    const indexes = [
      // Translation cache indexes
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_hash_langs ON translation_cache(hash, source_lang, target_lang)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_created ON translation_cache(created_at DESC)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cache_hits ON translation_cache(hits DESC)',
      
      // Usage tracking indexes
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_workspace_date ON usage_tracking(workspace_id, created_at DESC)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_user ON usage_tracking(user_id, created_at DESC)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_cost ON usage_tracking(cost_amount DESC)',
      
      // Analytics indexes
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_workspace_date ON analytics_daily(workspace_id, date DESC)',
      
      // User preferences indexes
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prefs_user_workspace ON user_preferences(user_id, workspace_id)',
    ];
    
    for (const index of indexes) {
      await this.db.query(index);
    }
  }
  
  async analyzeAndVacuum(): Promise<void> {
    const tables = [
      'translation_cache',
      'usage_tracking',
      'analytics_daily',
      'user_preferences',
      'channel_configs',
    ];
    
    for (const table of tables) {
      await this.db.query(`ANALYZE ${table}`);
      await this.db.query(`VACUUM (ANALYZE) ${table}`);
    }
  }
  
  async setupPartitioning(): Promise<void> {
    // Partition usage_tracking by month for better performance
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS usage_tracking_partitioned (
        LIKE usage_tracking INCLUDING ALL
      ) PARTITION BY RANGE (created_at);
    `);
    
    // Create partitions for next 12 months
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const startDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
      const partitionName = `usage_tracking_${startDate.getFullYear()}_${String(startDate.getMonth() + 1).padStart(2, '0')}`;
      
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS ${partitionName} 
        PARTITION OF usage_tracking_partitioned
        FOR VALUES FROM ('${startDate.toISOString()}') 
        TO ('${endDate.toISOString()}');
      `);
    }
  }
}
```

#### Task 5.4: Redis Caching Strategy
```typescript
// api/src/services/CacheService.ts
import { createHash } from 'crypto';

export class CacheService {
  private readonly TTL = {
    translation: 24 * 60 * 60,      // 24 hours
    userPrefs: 12 * 60 * 60,        // 12 hours
    channelConfig: 6 * 60 * 60,     // 6 hours
    providerHealth: 5 * 60,         // 5 minutes
    contextBuffer: 30 * 60,         // 30 minutes
    analytics: 60 * 60,             // 1 hour
  };
  
  constructor(private redis: Redis) {}
  
  generateTranslationKey(text: string, sourceLang: string, targetLang: string, context?: string): string {
    const data = `${text}:${sourceLang}:${targetLang}:${context || ''}`;
    return `translation:${createHash('md5').update(data).digest('hex')}`;
  }
  
  async getCachedTranslation(
    text: string, 
    sourceLang: string, 
    targetLang: string, 
    context?: string
  ): Promise<TranslationResponse | null> {
    const key = this.generateTranslationKey(text, sourceLang, targetLang, context);
    const cached = await this.redis.get(key);
    
    if (cached) {
      // Update hit count asynchronously
      this.updateHitCount(key).catch(console.error);
      
      const translation = JSON.parse(cached);
      translation.metadata.cacheHit = true;
      return translation;
    }
    
    return null;
  }
  
  async cacheTranslation(
    text: string,
    sourceLang: string,
    targetLang: string,
    translation: TranslationResponse,
    context?: string
  ): Promise<void> {
    const key = this.generateTranslationKey(text, sourceLang, targetLang, context);
    
    await this.redis.setex(
      key,
      this.TTL.translation,
      JSON.stringify(translation)
    );
    
    // Also cache in database for long-term storage
    await this.saveToDatabaseCache(text, sourceLang, targetLang, translation);
  }
  
  async warmupCache(workspaceId: string): Promise<void> {
    // Load frequently used translations into cache
    const frequent = await this.db.query(`
      SELECT 
        source_text, 
        translated_text, 
        source_lang, 
        target_lang,
        provider,
        model
      FROM translation_cache
      WHERE hits > 10
      ORDER BY hits DESC, created_at DESC
      LIMIT 1000
    `);
    
    const pipeline = this.redis.pipeline();
    
    for (const row of frequent.rows) {
      const key = this.generateTranslationKey(
        row.source_text,
        row.source_lang,
        row.target_lang
      );
      
      const translation: TranslationResponse = {
        translatedText: row.translated_text,
        originalText: row.source_text,
        sourceLang: row.source_lang,
        targetLang: row.target_lang,
        provider: row.provider,
        model: row.model,
        confidence: 1.0,
        cost: { amount: 0, currency: 'EUR', tokensUsed: 0 },
        metadata: {
          cacheHit: true,
          translationTimeMs: 0,
          requestId: 'cached',
        },
      };
      
      pipeline.setex(key, this.TTL.translation, JSON.stringify(translation));
    }
    
    await pipeline.exec();
  }
  
  async invalidateUserCache(userId: string): Promise<void> {
    const pattern = `user:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
  
  async getCacheStats(): Promise<CacheStats> {
    const info = await this.redis.info('stats');
    const dbSize = await this.redis.dbsize();
    
    // Parse Redis info
    const stats = this.parseRedisInfo(info);
    
    return {
      totalKeys: dbSize,
      hitRate: stats.keyspace_hits / (stats.keyspace_hits + stats.keyspace_misses),
      memoryUsed: stats.used_memory_human,
      evictedKeys: stats.evicted_keys,
      connectedClients: stats.connected_clients,
    };
  }
}
```

### Error Handling & Resilience

#### Task 5.5: Circuit Breaker Implementation
```typescript
// api/src/utils/CircuitBreaker.ts
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private successCount = 0;
  private lastFailureTime?: Date;
  private nextAttempt?: Date;
  
  constructor(
    private readonly options: {
      failureThreshold: number;
      successThreshold: number;
      timeout: number;
      resetTimeout: number;
    }
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (new Date() < this.nextAttempt!) {
        throw new CircuitOpenError('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await this.callWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private async callWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), this.options.timeout)
      ),
    ]);
  }
  
  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
      }
    }
  }
  
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();
    
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
      this.successCount = 0;
    }
  }
  
  getState(): string {
    return this.state;
  }
  
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
    };
  }
}
```

#### Task 5.6: Graceful Degradation
```typescript
// api/src/services/FallbackService.ts
export class FallbackService {
  async translateWithFallback(
    request: TranslationRequest,
    providers: ITranslationProvider[]
  ): Promise<TranslationResponse> {
    const errors: Error[] = [];
    
    // Try primary provider
    for (const provider of providers) {
      try {
        return await provider.translate(request);
      } catch (error) {
        errors.push(error);
        console.error(`Provider ${provider.name} failed:`, error);
      }
    }
    
    // All providers failed, try cache
    const cached = await this.cacheService.getCachedTranslation(
      request.text,
      request.sourceLang,
      request.targetLang
    );
    
    if (cached) {
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          fallbackUsed: true,
          degradedMode: true,
        },
      };
    }
    
    // Return untranslated text as last resort
    return {
      translatedText: request.text,
      originalText: request.text,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      confidence: 0,
      provider: 'none',
      model: 'fallback',
      cost: { amount: 0, currency: 'EUR', tokensUsed: 0 },
      metadata: {
        translationTimeMs: 0,
        cacheHit: false,
        requestId: crypto.randomUUID(),
        error: 'All providers failed',
        degradedMode: true,
      },
    };
  }
}
```

---

## Week 9-10: Comprehensive Testing

### Unit Testing Suite

#### Task 6.1: Translation Service Tests
```typescript
// tests/unit/TranslationService.test.ts
import { TranslationService } from '../../api/src/services/TranslationService';
import { mock } from 'jest-mock-extended';

describe('TranslationService', () => {
  let service: TranslationService;
  let mockProvider: jest.Mocked<ITranslationProvider>;
  let mockCache: jest.Mocked<CacheService>;
  
  beforeEach(() => {
    mockProvider = mock<ITranslationProvider>();
    mockCache = mock<CacheService>();
    service = new TranslationService(mockProvider, mockCache);
  });
  
  describe('translate', () => {
    it('should return cached translation when available', async () => {
      const cachedTranslation = {
        translatedText: 'Hola',
        originalText: 'Hello',
        sourceLang: 'en',
        targetLang: 'es',
      };
      
      mockCache.getCachedTranslation.mockResolvedValue(cachedTranslation);
      
      const result = await service.translate({
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'es',
      });
      
      expect(result).toEqual(cachedTranslation);
      expect(mockProvider.translate).not.toHaveBeenCalled();
    });
    
    it('should call provider when cache miss', async () => {
      mockCache.getCachedTranslation.mockResolvedValue(null);
      mockProvider.translate.mockResolvedValue({
        translatedText: 'Bonjour',
        originalText: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
      });
      
      const result = await service.translate({
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'fr',
      });
      
      expect(result.translatedText).toBe('Bonjour');
      expect(mockCache.cacheTranslation).toHaveBeenCalled();
    });
    
    it('should handle provider failures gracefully', async () => {
      mockCache.getCachedTranslation.mockResolvedValue(null);
      mockProvider.translate.mockRejectedValue(new Error('API Error'));
      
      await expect(service.translate({
        text: 'Test',
        sourceLang: 'en',
        targetLang: 'de',
      })).rejects.toThrow('Translation failed');
    });
  });
  
  describe('language detection', () => {
    it('should detect language correctly', async () => {
      mockProvider.detectLanguage.mockResolvedValue('es');
      
      const result = await service.detectLanguage('Hola mundo');
      
      expect(result).toBe('es');
    });
    
    it('should cache language detection results', async () => {
      mockProvider.detectLanguage.mockResolvedValue('fr');
      
      await service.detectLanguage('Bonjour');
      await service.detectLanguage('Bonjour');
      
      expect(mockProvider.detectLanguage).toHaveBeenCalledTimes(1);
    });
  });
});
```

#### Task 6.2: Billing Service Tests
```typescript
// tests/unit/BillingService.test.ts
describe('BillingService', () => {
  let service: BillingService;
  let mockDb: jest.Mocked<Database>;
  
  beforeEach(() => {
    mockDb = mock<Database>();
    service = new BillingService(mockDb);
  });
  
  describe('credit management', () => {
    it('should initialize workspace with freemium credits', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      
      await service.initializeWorkspace('workspace-123');
      
      const credits = await service.getWorkspaceCredits('workspace-123');
      expect(credits.balance).toBe(3.00);
      expect(credits.plan).toBe('freemium');
    });
    
    it('should deduct credits correctly', async () => {
      await service.initializeWorkspace('workspace-123');
      
      const result = await service.deductCredits('workspace-123', 0.01, 'Translation');
      
      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(2.99);
    });
    
    it('should trigger auto-recharge when balance low', async () => {
      const workspace = {
        workspaceId: 'workspace-123',
        balance: 0.50,
        autoRecharge: true,
        rechargeThreshold: 1.00,
        rechargeAmount: 10.00,
      };
      
      jest.spyOn(service, 'getWorkspaceCredits').mockResolvedValue(workspace);
      const rechargeSpy = jest.spyOn(service, 'rechargeCredits');
      
      await service.deductCredits('workspace-123', 0.10, 'Translation');
      
      expect(rechargeSpy).toHaveBeenCalledWith('workspace-123', 10.00);
    });
    
    it('should throw error on insufficient credits', async () => {
      await service.initializeWorkspace('workspace-123');
      
      await expect(
        service.deductCredits('workspace-123', 5.00, 'Translation')
      ).rejects.toThrow('Insufficient credits');
    });
  });
});
```

### Integration Testing

#### Task 6.3: End-to-End Translation Flow
```typescript
// tests/integration/TranslationFlow.test.ts
import request from 'supertest';
import app from '../../api/src/app';

describe('Translation Flow Integration', () => {
  let authToken: string;
  
  beforeAll(async () => {
    // Setup test database
    await setupTestDatabase();
    
    // Get auth token
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'testuser', password: 'testpass' });
    
    authToken = response.body.token;
  });
  
  describe('Complete translation workflow', () => {
    it('should translate message for multiple users', async () => {
      // Step 1: Set user preferences
      await request(app)
        .put('/api/v1/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          targetLanguage: 'es',
          enabled: true,
        })
        .expect(200);
      
      // Step 2: Send translation request
      const response = await request(app)
        .post('/api/v1/translate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: 'Hello world',
          targetLang: 'es',
        })
        .expect(200);
      
      expect(response.body.translatedText).toBe('Hola mundo');
      expect(response.body.provider).toBeDefined();
      expect(response.body.cost).toBeDefined();
      
      // Step 3: Verify caching
      const cachedResponse = await request(app)
        .post('/api/v1/translate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          text: 'Hello world',
          targetLang: 'es',
        })
        .expect(200);
      
      expect(cachedResponse.body.metadata.cacheHit).toBe(true);
    });
    
    it('should handle rate limiting', async () => {
      // Send many requests quickly
      const promises = Array(60).fill(null).map(() =>
        request(app)
          .post('/api/v1/translate')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            text: 'Test',
            targetLang: 'fr',
          })
      );
      
      const results = await Promise.allSettled(promises);
      const rateLimited = results.filter(r => 
        r.status === 'fulfilled' && r.value.status === 429
      );
      
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});
```

#### Task 6.4: Plugin Integration Tests
```typescript
// tests/integration/RocketChatPlugin.test.ts
describe('Rocket.Chat Plugin Integration', () => {
  let rocketChat: RocketChatTestClient;
  let plugin: UniversalTranslatorApp;
  
  beforeAll(async () => {
    rocketChat = new RocketChatTestClient();
    await rocketChat.connect();
    
    plugin = await rocketChat.installPlugin('universal-translator-pro');
  });
  
  it('should intercept and translate messages', async () => {
    // Create test room
    const room = await rocketChat.createRoom('test-room');
    
    // Add users with different languages
    const user1 = await rocketChat.createUser('user1', { language: 'en' });
    const user2 = await rocketChat.createUser('user2', { language: 'es' });
    
    await room.addMembers([user1, user2]);
    
    // User1 sends message in English
    const message = await user1.sendMessage(room, 'Hello everyone');
    
    // User2 should see Spanish translation
    const user2Messages = await user2.getMessages(room);
    const translatedMessage = user2Messages.find(m => m.id === message.id);
    
    expect(translatedMessage.translatedText).toBe('Hola a todos');
    expect(translatedMessage.originalText).toBe('Hello everyone');
  });
  
  it('should respect user preferences', async () => {
    const user = await rocketChat.createUser('user3');
    
    // Disable translation for user
    await plugin.updateUserPreferences(user.id, {
      enabled: false,
    });
    
    const room = await rocketChat.createRoom('test-room-2');
    const message = await user.sendMessage(room, 'Bonjour');
    
    // Message should not be translated
    const messages = await user.getMessages(room);
    expect(messages[0].translatedText).toBeUndefined();
  });
});
```

### Performance Testing

#### Task 6.5: Load Testing Script
```javascript
// tests/performance/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 1000 },  // Ramp up to 1000 users
    { duration: '10m', target: 1000 }, // Stay at 1000 users
    { duration: '5m', target: 100 },   // Ramp down to 100 users
    { duration: '2m', target: 0 },     // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    errors: ['rate<0.01'],              // Error rate under 1%
  },
};

const BASE_URL = 'https://translator.noreika.lt/api/v1';

export function setup() {
  // Get auth token
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    username: 'loadtest',
    password: 'loadtest123',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  return { token: loginRes.json('token') };
}

export default function(data) {
  const texts = [
    'Hello world',
    'How are you today?',
    'This is a test message',
    'The quick brown fox jumps over the lazy dog',
    'Testing translation service performance',
  ];
  
  const languages = ['es', 'fr', 'de', 'pt', 'ru', 'ja', 'ko', 'zh'];
  
  const text = texts[Math.floor(Math.random() * texts.length)];
  const targetLang = languages[Math.floor(Math.random() * languages.length)];
  
  const payload = JSON.stringify({
    text: text,
    targetLang: targetLang,
    sourceLang: 'en',
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.token}`,
    },
    timeout: '10s',
  };
  
  const res = http.post(`${BASE_URL}/translate`, payload, params);
  
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 2s': (r) => r.timings.duration < 2000,
    'has translated text': (r) => r.json('translatedText') !== undefined,
  });
  
  errorRate.add(!success);
  
  sleep(Math.random() * 2); // Random sleep between 0-2 seconds
}

export function teardown(data) {
  // Cleanup
}
```

#### Task 6.6: Stress Testing
```javascript
// tests/performance/stress-test.js
export let options = {
  stages: [
    { duration: '30s', target: 2000 },  // Spike to 2000 users
    { duration: '1m', target: 2000 },   // Stay at 2000 users
    { duration: '30s', target: 5000 },  // Spike to 5000 users
    { duration: '1m', target: 5000 },   // Stay at 5000 users
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.1'],      // Error rate under 10%
    http_req_duration: ['p(95)<5000'],  // 95% under 5s during stress
  },
};

// Similar test function as load test but with more aggressive scenarios
```

### Security Testing

#### Task 6.7: Security Audit Checklist
```typescript
// tests/security/security-audit.ts
describe('Security Audit', () => {
  describe('Authentication', () => {
    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/v1/preferences')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);
    });
    
    it('should prevent JWT algorithm confusion', async () => {
      const maliciousToken = jwt.sign(
        { userId: 'admin' },
        'public-key',
        { algorithm: 'HS256' }
      );
      
      await request(app)
        .get('/api/v1/preferences')
        .set('Authorization', `Bearer ${maliciousToken}`)
        .expect(403);
    });
  });
  
  describe('Input Validation', () => {
    it('should sanitize user input', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      const response = await request(app)
        .post('/api/v1/translate')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          text: xssPayload,
          targetLang: 'es',
        })
        .expect(200);
      
      expect(response.body.translatedText).not.toContain('<script>');
    });
    
    it('should prevent SQL injection', async () => {
      const sqlPayload = "'; DROP TABLE users; --";
      
      await request(app)
        .get(`/api/v1/analytics?userId=${sqlPayload}`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(400);
    });
  });
  
  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const requests = Array(150).fill(null).map(() =>
        request(app)
          .post('/api/v1/translate')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ text: 'Test', targetLang: 'fr' })
      );
      
      const results = await Promise.all(requests);
      const rateLimited = results.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
  
  describe('Data Encryption', () => {
    it('should encrypt API keys at rest', async () => {
      const apiKey = 'sk-test-12345';
      
      await db.query(
        'INSERT INTO provider_configs (workspace_id, api_key_encrypted) VALUES ($1, $2)',
        ['workspace-123', encryptApiKey(apiKey)]
      );
      
      const result = await db.query(
        'SELECT api_key_encrypted FROM provider_configs WHERE workspace_id = $1',
        ['workspace-123']
      );
      
      expect(result.rows[0].api_key_encrypted).not.toBe(apiKey);
      expect(decryptApiKey(result.rows[0].api_key_encrypted)).toBe(apiKey);
    });
  });
});
```

---

## 📋 Phase 3 Completion Checklist

### Advanced Features ✓
- [ ] Billing system integrated
- [ ] Usage tracking implemented
- [ ] Cost calculation accurate
- [ ] Auto-recharge functionality
- [ ] Analytics dashboard complete

### Performance Optimization ✓
- [ ] Database indexes created
- [ ] Query optimization complete
- [ ] Redis caching implemented
- [ ] Connection pooling configured
- [ ] Batch processing active

### Error Handling ✓
- [ ] Circuit breakers implemented
- [ ] Graceful degradation working
- [ ] Fallback mechanisms tested
- [ ] Error logging comprehensive
- [ ] Recovery procedures documented

### Testing Suite ✓
- [ ] Unit tests >85% coverage
- [ ] Integration tests passing
- [ ] Load testing successful
- [ ] Security audit complete
- [ ] Performance targets met

---

## 🚀 Ready for Phase 4

With Phase 3 complete, the system is ready for:
- Production deployment
- Marketplace submission
- Documentation finalization
- Marketing launch
- Support preparation

---

**Phase Owner**: QA Lead + DevOps  
**Estimated Completion**: 4 weeks  
**Next Phase**: Launch Preparation (Weeks 11-12)