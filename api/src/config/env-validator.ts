import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import { Client } from 'pg';
import Redis from 'ioredis';
import axios from 'axios';

// Load environment variables
dotenv.config();

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;

  // Database
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;

  // Redis
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;

  // Rocket.Chat
  ROCKETCHAT_URL: string;
  ROCKETCHAT_ADMIN_USER: string;
  ROCKETCHAT_ADMIN_PASS: string;

  // Security
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  ENCRYPTION_KEY: string;
  INTERNAL_SECRET: string;

  // CORS
  ALLOWED_ORIGINS: string;

  // Logging
  LOG_LEVEL: string;
  LOG_TO_CONSOLE: boolean;

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
}

function validateEnv(): EnvConfig {
  const missing: string[] = [];

  // Required environment variables
  const required = [
    'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'REDIS_HOST',
    'ROCKETCHAT_URL', 'ROCKETCHAT_ADMIN_USER', 'ROCKETCHAT_ADMIN_PASS',
    'JWT_SECRET', 'ENCRYPTION_KEY', 'INTERNAL_SECRET'
  ];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3001', 10),

    DB_HOST: process.env.DB_HOST!,
    DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
    DB_NAME: process.env.DB_NAME!,
    DB_USER: process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,

    REDIS_HOST: process.env.REDIS_HOST!,
    REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,

    ROCKETCHAT_URL: process.env.ROCKETCHAT_URL!,
    ROCKETCHAT_ADMIN_USER: process.env.ROCKETCHAT_ADMIN_USER!,
    ROCKETCHAT_ADMIN_PASS: process.env.ROCKETCHAT_ADMIN_PASS!,

    JWT_SECRET: process.env.JWT_SECRET!,
    JWT_EXPIRY: process.env.JWT_EXPIRY || '24h',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    INTERNAL_SECRET: process.env.INTERNAL_SECRET!,

    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:3000',

    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    LOG_TO_CONSOLE: process.env.LOG_TO_CONSOLE === 'true',

    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
  };
}

export async function preflight(): Promise<EnvConfig> {
  console.log('🚀 Starting preflight checks...');

  // 1. Validate environment variables
  console.log('📋 Validating environment variables...');
  const config = validateEnv();
  console.log('✅ Environment variables validated');

  // 2. Test database connection
  console.log('🗄️ Testing database connection...');
  const pgClient = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD
  });

  try {
    await pgClient.connect();
    await pgClient.query('SELECT 1');
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw new Error(`Database connection failed: ${error}`);
  } finally {
    await pgClient.end();
  }

  // 3. Test Redis connection
  console.log('📦 Testing Redis connection...');
  const redis = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    retryStrategy: () => null // Don't retry during preflight
  });

  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }
    console.log('✅ Redis connection successful');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw new Error(`Redis connection failed: ${error}`);
  } finally {
    redis.disconnect();
  }

  // 4. Test Rocket.Chat connection
  console.log('🚀 Testing Rocket.Chat connection...');
  try {
    const response = await axios.get(`${config.ROCKETCHAT_URL}/api/info`, {
      timeout: 5000
    });

    if (response.status === 200) {
      console.log('✅ Rocket.Chat connection successful');
    } else {
      throw new Error(`Rocket.Chat returned status ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Rocket.Chat connection failed:', error);
    console.log('⚠️ Continuing despite Rocket.Chat connection failure (it may start later)');
    // Don't throw here - Rocket.Chat might start later
  }

  console.log('✅ All preflight checks passed!');
  return config;
}

export { EnvConfig };