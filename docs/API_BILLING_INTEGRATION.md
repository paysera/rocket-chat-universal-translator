# 💳 API Billing Integration Documentation

## Overview

This document describes the billing integration between the Universal Translator Pro Rocket.Chat plugin and the translator.noreika.lt API service.

## 🏗️ Architecture

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Rocket.Chat       │    │   Marketplace       │    │  translator.noreika │
│   Plugin            │    │   Billing System    │    │  .lt API            │
│                     │    │                     │    │                     │
│ ┌─────────────────┐ │    │ ┌─────────────────┐ │    │ ┌─────────────────┐ │
│ │ Translation     │◄┼────┼►│ Credit System   │◄┼────┼►│ Usage Tracking  │ │
│ │ Requests        │ │    │ │                 │ │    │ │                 │ │
│ └─────────────────┘ │    │ └─────────────────┘ │    │ └─────────────────┘ │
│                     │    │                     │    │                     │
│ ┌─────────────────┐ │    │ ┌─────────────────┐ │    │ ┌─────────────────┐ │
│ │ Admin Analytics │◄┼────┼►│ Billing Reports │◄┼────┼►│ Token Analytics │ │
│ │                 │ │    │ │                 │ │    │ │                 │ │
│ └─────────────────┘ │    │ └─────────────────┘ │    │ └─────────────────┘ │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

## 🔑 Authentication & API Keys

### Primary: Marketplace Integration
```typescript
interface MarketplaceBilling {
  workspaceId: string;
  pluginId: 'universal-translator-pro';
  credits: {
    included: 3.00;        // EUR - included per workspace per month
    balance: number;       // Current available balance
    consumed: number;      // Used this billing cycle
  };
  billing: {
    cycle: 'monthly';
    nextBilling: Date;
    overage: number;       // EUR charged for usage beyond included credits
  };
}
```

### Fallback: Direct API Registration
```typescript
interface DirectAPIBilling {
  workspaceId: string;
  apiKey: string;          // tk_xxxxxxxxxxxxxxxxxx
  registrationUrl: 'https://translator.noreika.lt/register';
  billing: 'direct';       // Customer pays translator.noreika.lt directly
}
```

## 🔄 Billing Flow

### 1. Plugin Installation (Marketplace)
```typescript
// When plugin is installed via marketplace
async function onPluginInstall(workspace: IWorkspace): Promise<void> {
  // Create workspace account with included credits
  const account = await createWorkspaceAccount({
    workspaceId: workspace.id,
    plan: 'freemium',
    includedCredits: 3.00,  // EUR
    billingCycle: 'monthly'
  });
  
  // Generate marketplace API key for translator.noreika.lt
  const apiKey = await generateMarketplaceAPIKey(workspace.id);
  
  // Store billing configuration
  await saveWorkspaceBilling({
    workspaceId: workspace.id,
    billingMethod: 'marketplace',
    apiKey: apiKey,
    account: account
  });
}
```

### 2. Translation Request Flow
```typescript
// Every translation request flow
async function translateMessage(request: TranslationRequest): Promise<TranslationResponse> {
  const billing = await getWorkspaceBilling(request.workspaceId);
  
  // Check available balance
  if (billing.method === 'marketplace') {
    const balance = await checkMarketplaceBalance(billing.workspaceId);
    if (balance.available <= 0) {
      // Still process translation, charge to marketplace
      logger.info(`Workspace ${billing.workspaceId} exceeding included credits`);
    }
  }
  
  // Make translation request to translator.noreika.lt
  const response = await translator.translate({
    ...request,
    apiKey: billing.apiKey
  });
  
  // Track usage for billing
  await trackTranslationUsage({
    workspaceId: request.workspaceId,
    cost: response.cost.amount,
    tokens: response.cost.tokens_used,
    provider: response.provider,
    timestamp: new Date()
  });
  
  return response;
}
```

### 3. Monthly Billing Cycle
```typescript
// Monthly billing reconciliation
async function processMonthlyBilling(): Promise<void> {
  const workspaces = await getMarketplaceBilledWorkspaces();
  
  for (const workspace of workspaces) {
    const usage = await getMonthlyUsage(workspace.id);
    
    if (usage.totalCost > workspace.includedCredits) {
      const overage = usage.totalCost - workspace.includedCredits;
      
      // Charge overage through marketplace billing
      await chargeMarketplaceOverage({
        workspaceId: workspace.id,
        amount: overage,
        currency: 'EUR',
        description: `Translation overage: ${usage.totalTranslations} translations`,
        period: {
          start: usage.periodStart,
          end: usage.periodEnd
        }
      });
    }
    
    // Reset monthly counters
    await resetMonthlyCounters(workspace.id);
  }
}
```

## 📊 Usage Tracking

### Translation Usage Analytics
```typescript
interface TranslationUsageAnalytics {
  workspaceId: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalTranslations: number;
    totalTokens: number;
    totalCost: number;            // EUR
    averageCostPerTranslation: number;
  };
  breakdown: {
    byUser: Array<{
      userId: string;
      username: string;
      translations: number;
      tokens: number;
      cost: number;
    }>;
    byChannel: Array<{
      channelId: string;
      channelName: string;
      translations: number;
      tokens: number;
      cost: number;
    }>;
    byLanguagePair: Array<{
      sourceLanguage: string;
      targetLanguage: string;
      translations: number;
      cost: number;
    }>;
  };
  includedCredits: number;
  overage: number;
  nextBillingDate: Date;
}
```

### Admin Dashboard Data
```typescript
// API endpoint for admin analytics
app.get('/api/v1/analytics/usage', authenticateAdmin, async (req, res) => {
  const { workspaceId, period } = req.query;
  
  const analytics = await generateUsageAnalytics({
    workspaceId,
    period: {
      start: new Date(period.start),
      end: new Date(period.end)
    }
  });
  
  res.json({
    success: true,
    data: analytics,
    billing: {
      method: 'marketplace',
      status: 'active',
      nextBilling: analytics.nextBillingDate
    }
  });
});
```

## 🔧 Configuration

### Plugin Configuration (Admin)
```typescript
interface PluginConfiguration {
  billing: {
    method: 'marketplace' | 'direct';
    apiKey?: string;          // For direct billing method
    includedCredits: number;  // Monthly included credits
  };
  limits: {
    perMinute: number;        // Rate limit per minute
    perHour: number;          // Rate limit per hour  
    perUser: number;          // Daily limit per user
    perChannel: number;       // Daily limit per channel
  };
  features: {
    realTimeTranslation: boolean;
    historicalTranslation: boolean;
    analytics: boolean;
  };
}
```

### User Settings
```typescript
interface UserTranslationSettings {
  enabled: boolean;
  targetLanguage: string;     // ISO 639-1 code (e.g., 'en', 'lt', 'ru')
  showOriginalOnHover: boolean;
  autoTranslateChannels: string[];  // Channel IDs where translation is enabled
}
```

## 💡 Error Handling

### Billing Errors
```typescript
enum BillingError {
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  API_KEY_INVALID = 'api_key_invalid',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  BILLING_ACCOUNT_SUSPENDED = 'billing_account_suspended'
}

async function handleBillingError(error: BillingError, context: any): Promise<void> {
  switch (error) {
    case BillingError.INSUFFICIENT_BALANCE:
      // Continue translating, charge overage
      logger.warn(`Workspace ${context.workspaceId} exceeding credits`);
      break;
      
    case BillingError.API_KEY_INVALID:
      // Disable translation for workspace
      await disableTranslationForWorkspace(context.workspaceId);
      await notifyAdmins(context.workspaceId, 'Translation disabled: Invalid API key');
      break;
      
    case BillingError.RATE_LIMIT_EXCEEDED:
      // Temporary cooldown
      await applyRateLimit(context.workspaceId, 300); // 5 minute cooldown
      break;
      
    case BillingError.BILLING_ACCOUNT_SUSPENDED:
      // Disable all translation features
      await suspendTranslationFeatures(context.workspaceId);
      break;
  }
}
```

### API Failure Handling
```typescript
async function handleAPIFailure(request: TranslationRequest): Promise<TranslationResponse | null> {
  try {
    // Primary translation attempt
    return await translator.translate(request);
  } catch (error) {
    logger.error('Translation API failed:', error);
    
    // Check for cached translation
    const cached = await getCachedTranslation(request.text, request.target_lang);
    if (cached) {
      return {
        ...cached,
        metadata: { ...cached.metadata, cache_hit: true, api_fallback: true }
      };
    }
    
    // Silent failure - no error to user
    return null;
  }
}
```

## 🧪 Testing Strategy

### Billing Integration Tests
```typescript
describe('Billing Integration', () => {
  test('should create marketplace account on plugin install', async () => {
    const workspace = mockWorkspace();
    await onPluginInstall(workspace);
    
    const billing = await getWorkspaceBilling(workspace.id);
    expect(billing.method).toBe('marketplace');
    expect(billing.includedCredits).toBe(3.00);
  });
  
  test('should track translation usage correctly', async () => {
    const request = mockTranslationRequest();
    const response = await translateMessage(request);
    
    const usage = await getWorkspaceUsage(request.workspaceId);
    expect(usage.totalCost).toBeGreaterThan(0);
    expect(usage.totalTranslations).toBe(1);
  });
  
  test('should handle overage billing', async () => {
    const workspace = mockWorkspace({ includedCredits: 0.01 });
    const request = mockTranslationRequest({ workspaceId: workspace.id });
    
    await translateMessage(request);
    
    const billing = await getWorkspaceBilling(workspace.id);
    expect(billing.overage).toBeGreaterThan(0);
  });
});
```

### Rate Limiting Tests
```typescript
describe('Rate Limiting', () => {
  test('should enforce per-minute rate limits', async () => {
    const requests = Array(101).fill(mockTranslationRequest());
    const results = await Promise.allSettled(
      requests.map(req => translateMessage(req))
    );
    
    const rejected = results.filter(r => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
  });
});
```

## 📈 Monitoring & Alerts

### Key Metrics
- **Translation Volume**: Requests per minute/hour/day
- **Cost Tracking**: EUR spent per workspace per day
- **Error Rates**: Failed translations / total attempts
- **API Latency**: Average response time from translator.noreika.lt
- **Cache Hit Rate**: Cached translations / total requests

### Alerts
- API error rate > 5%
- Average latency > 10 seconds
- Workspace exceeding 10x included credits
- API service health check failures

---

**Document Owner**: Engineering Team  
**Last Updated**: 2024-09-12  
**Integration Status**: Ready for Implementation