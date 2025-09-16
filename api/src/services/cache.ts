import Redis from 'ioredis';

export interface CacheConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    maxRetriesPerRequest?: number;
}

export class CacheService {
    private client: Redis;
    private isConnected: boolean = false;

    constructor(config: CacheConfig) {
        this.client = new Redis({
            host: config.host,
            port: config.port,
            password: config.password,
            db: config.db || 0,
            maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
            lazyConnect: true,
        });

        this.client.on('connect', () => {
            this.isConnected = true;
        });

        this.client.on('error', (err) => {
            console.error('Redis error:', err);
            this.isConnected = false;
        });
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
        } catch (error) {
            throw new Error(`Failed to connect to cache: ${error}`);
        }
    }

    async disconnect(): Promise<void> {
        await this.client.disconnect();
        this.isConnected = false;
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error(`Cache get error for key ${key}:`, error);
            return null;
        }
    }

    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        try {
            const serialized = JSON.stringify(value);
            if (ttlSeconds) {
                await this.client.setex(key, ttlSeconds, serialized);
            } else {
                await this.client.set(key, serialized);
            }
        } catch (error) {
            console.error(`Cache set error for key ${key}:`, error);
            // Don't throw - cache errors should not break the application
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (error) {
            console.error(`Cache delete error for key ${key}:`, error);
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            console.error(`Cache exists error for key ${key}:`, error);
            return false;
        }
    }

    async flush(): Promise<void> {
        try {
            await this.client.flushdb();
        } catch (error) {
            console.error('Cache flush error:', error);
        }
    }

    isHealthy(): boolean {
        return this.isConnected;
    }

    // Translation-specific cache methods
    generateTranslationCacheKey(text: string, sourceLang: string, targetLang: string, provider: string): string {
        const hash = Buffer.from(text).toString('base64');
        return `translation:${provider}:${sourceLang}:${targetLang}:${hash}`;
    }

    async getCachedTranslation(text: string, sourceLang: string, targetLang: string, provider: string): Promise<any | null> {
        const key = this.generateTranslationCacheKey(text, sourceLang, targetLang, provider);
        return await this.get(key);
    }

    async cacheTranslation(
        text: string,
        sourceLang: string,
        targetLang: string,
        provider: string,
        translation: any,
        ttlHours: number = 24
    ): Promise<void> {
        const key = this.generateTranslationCacheKey(text, sourceLang, targetLang, provider);
        await this.set(key, translation, ttlHours * 3600);
    }

    // Rate limiting support
    async incrementRateLimit(key: string, window: number): Promise<number> {
        try {
            const current = await this.client.incr(key);
            if (current === 1) {
                await this.client.expire(key, window);
            }
            return current;
        } catch (error) {
            console.error(`Rate limit error for key ${key}:`, error);
            return 0;
        }
    }
}