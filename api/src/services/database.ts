import { Pool, PoolClient } from 'pg';

export interface DatabaseConfig {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl?: boolean;
}

export class DatabaseService {
    private pool: Pool;
    private isConnected: boolean = false;

    constructor(config: DatabaseConfig) {
        this.pool = new Pool({
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }

    async connect(): Promise<void> {
        try {
            const client = await this.pool.connect();
            client.release();
            this.isConnected = true;
        } catch (error) {
            throw new Error(`Failed to connect to database: ${error}`);
        }
    }

    async disconnect(): Promise<void> {
        await this.pool.end();
        this.isConnected = false;
    }

    async query(text: string, params?: any[]): Promise<any> {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        } finally {
            client.release();
        }
    }

    async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    isHealthy(): boolean {
        return this.isConnected;
    }

    // Translation-specific methods
    async logTranslation(data: {
        text: string;
        sourceLang: string;
        targetLang: string;
        provider: string;
        userId?: string;
        cost?: number;
        processingTime: number;
    }): Promise<void> {
        const query = `
            INSERT INTO translation_logs (text, source_lang, target_lang, provider, user_id, cost, processing_time, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `;
        await this.query(query, [
            data.text,
            data.sourceLang,
            data.targetLang,
            data.provider,
            data.userId || null,
            data.cost || null,
            data.processingTime
        ]);
    }

    async getUserPreferences(userId: string): Promise<any> {
        const query = 'SELECT * FROM user_preferences WHERE user_id = $1';
        const result = await this.query(query, [userId]);
        return result.rows[0] || null;
    }

    async saveUserPreferences(userId: string, preferences: any): Promise<void> {
        const query = `
            INSERT INTO user_preferences (user_id, preferences, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET preferences = $2, updated_at = NOW()
        `;
        await this.query(query, [userId, JSON.stringify(preferences)]);
    }
}