import { BaseProvider } from '../providers/base';
import { ClaudeProvider } from '../providers/ClaudeProvider';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { DeepLProvider } from '../providers/DeepLProvider';

export interface ProviderSelectionCriteria {
    sourceLanguage: string;
    targetLanguage: string;
    textLength: number;
    textComplexity?: 'simple' | 'moderate' | 'complex';
    domain?: 'general' | 'technical' | 'medical' | 'legal' | 'creative';
    priority?: 'speed' | 'quality' | 'cost';
    requiredFeatures?: string[];
}

export interface ProviderScore {
    provider: BaseProvider;
    score: number;
    reasons: string[];
}

export class ProviderSelector {
    private providers: Map<string, BaseProvider> = new Map();
    private providerStats: Map<string, ProviderStatistics> = new Map();

    constructor() {
        // Initialize providers asynchronously after construction
        this.initializeProviders().catch(console.error);
    }

    private async initializeProviders(): Promise<void> {
        if (process.env.ANTHROPIC_API_KEY) {
            const claude = new ClaudeProvider();
            await claude.initialize(process.env.ANTHROPIC_API_KEY);
            this.providers.set('claude', claude);
        }

        if (process.env.OPENAI_API_KEY) {
            const openai = new OpenAIProvider();
            await openai.initialize(process.env.OPENAI_API_KEY);
            this.providers.set('openai', openai);
        }

        if (process.env.DEEPL_API_KEY) {
            const deepl = new DeepLProvider();
            await deepl.initialize(process.env.DEEPL_API_KEY);
            this.providers.set('deepl', deepl);
        }
    }

    async selectProvider(criteria: ProviderSelectionCriteria): Promise<BaseProvider> {
        const scores = await this.scoreProviders(criteria);
        
        if (scores.length === 0) {
            throw new Error('No providers available for the specified language pair');
        }

        scores.sort((a, b) => b.score - a.score);

        const healthyProvider = await this.findHealthyProvider(scores);
        
        if (!healthyProvider) {
            throw new Error('All providers are currently unavailable');
        }

        this.logProviderSelection(healthyProvider, criteria);
        
        return healthyProvider.provider;
    }

    private async scoreProviders(criteria: ProviderSelectionCriteria): Promise<ProviderScore[]> {
        const scores: ProviderScore[] = [];

        for (const [name, provider] of this.providers) {
            if (!provider.isLanguagePairSupported(criteria.sourceLanguage, criteria.targetLanguage)) {
                continue;
            }

            const score = this.calculateProviderScore(name, provider, criteria);
            scores.push(score);
        }

        return scores;
    }

    private calculateProviderScore(
        name: string,
        provider: BaseProvider,
        criteria: ProviderSelectionCriteria
    ): ProviderScore {
        let score = 100;
        const reasons: string[] = [];

        // Language pair optimization
        if (this.isEuropeanPair(criteria.sourceLanguage, criteria.targetLanguage)) {
            if (name === 'deepl') {
                score += 30;
                reasons.push('DeepL excels at European language pairs');
            }
        }

        // Asian language optimization
        if (this.isAsianLanguage(criteria.sourceLanguage) || this.isAsianLanguage(criteria.targetLanguage)) {
            if (name === 'openai') {
                score += 20;
                reasons.push('OpenAI has strong Asian language support');
            }
        }

        // Context and complexity handling
        if (criteria.textComplexity === 'complex' || criteria.domain === 'technical') {
            if (name === 'claude') {
                score += 25;
                reasons.push('Claude excels at complex and technical content');
            }
        }

        // Creative content
        if (criteria.domain === 'creative') {
            if (name === 'openai') {
                score += 20;
                reasons.push('OpenAI GPT-4 is optimal for creative content');
            }
        }

        // Cost optimization
        if (criteria.priority === 'cost') {
            const estimatedCost = provider.getEstimatedCost(criteria.textLength);
            if (estimatedCost < 0.001) {
                score += 15;
                reasons.push('Cost-effective for this text length');
            }
        }

        // Speed optimization
        if (criteria.priority === 'speed') {
            const stats = this.providerStats.get(name);
            if (stats && stats.averageLatency < 500) {
                score += 20;
                reasons.push('Fast response time');
            }
        }

        // Quality optimization
        if (criteria.priority === 'quality') {
            if (name === 'claude' || name === 'openai') {
                score += 15;
                reasons.push('Premium quality translation');
            }
        }

        // Long text handling
        if (criteria.textLength > 3000) {
            if (name === 'claude') {
                score += 15;
                reasons.push('Large context window for long texts');
            }
        }

        // Historical performance
        const stats = this.providerStats.get(name);
        if (stats) {
            score *= stats.successRate;
            if (stats.successRate < 0.95) {
                reasons.push(`Recent success rate: ${(stats.successRate * 100).toFixed(1)}%`);
            }
        }

        return { provider, score, reasons };
    }

    private async findHealthyProvider(scores: ProviderScore[]): Promise<ProviderScore | null> {
        for (const scoreEntry of scores) {
            try {
                const isHealthy = await scoreEntry.provider.getHealthStatus();
                if (isHealthy) {
                    return scoreEntry;
                }
            } catch (error) {
                console.warn(`Provider ${scoreEntry.provider.getName()} health check failed:`, error);
            }
        }
        return null;
    }

    private isEuropeanPair(source: string, target: string): boolean {
        const europeanLanguages = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'sv', 'da', 'no', 'fi'];
        return europeanLanguages.includes(source) && europeanLanguages.includes(target);
    }

    private isAsianLanguage(language: string): boolean {
        const asianLanguages = ['zh', 'ja', 'ko', 'th', 'vi', 'id', 'ms', 'hi', 'bn', 'ta'];
        return asianLanguages.includes(language);
    }

    private logProviderSelection(score: ProviderScore, criteria: ProviderSelectionCriteria): void {
        console.info('Provider selected:', {
            provider: score.provider.getName(),
            score: score.score,
            reasons: score.reasons,
            criteria: {
                languages: `${criteria.sourceLanguage} -> ${criteria.targetLanguage}`,
                textLength: criteria.textLength,
                priority: criteria.priority,
            },
        });
    }

    updateProviderStats(providerName: string, stats: Partial<ProviderStatistics>): void {
        const current = this.providerStats.get(providerName) || {
            successRate: 1.0,
            averageLatency: 0,
            totalRequests: 0,
            failedRequests: 0,
        };

        this.providerStats.set(providerName, {
            ...current,
            ...stats,
        });
    }

    getProviderStats(): Map<string, ProviderStatistics> {
        return new Map(this.providerStats);
    }
}

interface ProviderStatistics {
    successRate: number;
    averageLatency: number;
    totalRequests: number;
    failedRequests: number;
}