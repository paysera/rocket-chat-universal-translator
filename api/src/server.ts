import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { createServer } from 'http';

// Routes
import healthRoutes from './routes/health';
import translateRoutes from './routes/translate';
import preferencesRoutes from './routes/preferences';

// Database and Cache
import { pool, runMigrations, closeDatabase } from './config/database';
import { redis, closeRedis } from './config/redis';

// Middleware
import { errorHandler, notFoundHandler, timeoutHandler } from './middleware/errorHandler';
import { generalRateLimiter } from './middleware/rateLimiter';
import { requestLogger, log } from './utils/logger';
import { metricsMiddleware, metricsEndpoint } from './middleware/metrics';

dotenv.config();

export class Server {
    private app: Application;
    private port: number;

    constructor() {
        this.app = express();
        this.port = parseInt(process.env.PORT || '3001', 10);
    }

    private async initializeServices(): Promise<void> {
        try {
            // Test database connection
            await pool.query('SELECT 1');
            log.info('Database connected successfully');
            
            // Run migrations
            await runMigrations();
            log.info('Database migrations completed');
            
            // Test Redis connection
            await redis.ping();
            log.info('Redis connected successfully');
            
        } catch (error) {
            log.error('Failed to initialize services', error);
            throw error;
        }
    }

    private setupMiddleware(): void {
        // Security middleware
        this.app.use(helmet());
        this.app.use(cors({
            origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
            credentials: true,
        }));
        
        // Compression
        this.app.use(compression());
        
        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Request timeout
        this.app.use(timeoutHandler(30000));
        
        // Logging
        this.app.use(requestLogger);

        // Metrics collection (before rate limiting to capture all requests)
        this.app.use(metricsMiddleware);

        // Rate limiting
        this.app.use(generalRateLimiter);
        
        // Add request ID
        this.app.use((req: Request, _res: Response, next: NextFunction) => {
            req.headers['x-request-id'] = req.headers['x-request-id'] || 
                `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            next();
        });
    }

    private setupRoutes(): void {
        // Metrics endpoint (for Prometheus scraping)
        this.app.get('/metrics', metricsEndpoint);

        // API version prefix
        const apiV1 = '/api/v1';

        // Health check routes (no auth required)
        this.app.use(apiV1, healthRoutes);
        
        // Translation routes (auth required)
        this.app.use(apiV1, translateRoutes);
        
        // User preferences routes (auth required)
        this.app.use(apiV1, preferencesRoutes);
        
        // TODO: Add these routes when implemented
        // this.app.use(`${apiV1}/auth`, authRoutes);
        // this.app.use(`${apiV1}/billing`, billingRoutes);
        // this.app.use(`${apiV1}/admin`, adminRoutes);
        
        // 404 handler
        this.app.use(notFoundHandler);
        
        // Error handler (must be last)
        this.app.use(errorHandler);
    }

    public async start(): Promise<void> {
        try {
            await this.initializeServices();
            this.setupMiddleware();
            this.setupRoutes();

            const server = createServer(this.app);

            server.listen(this.port, () => {
                log.info(`🚀 Universal Translator API running on port ${this.port}`);
                log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
                log.info(`Health check: http://localhost:${this.port}/api/v1/health`);
            });

            // Graceful shutdown handlers
            const gracefulShutdown = async (signal: string) => {
                log.info(`${signal} received, starting graceful shutdown`);
                
                server.close(() => {
                    log.info('HTTP server closed');
                });
                
                try {
                    await closeDatabase();
                    log.info('Database connections closed');
                    
                    await closeRedis();
                    log.info('Redis connections closed');
                    
                    process.exit(0);
                } catch (error) {
                    log.error('Error during shutdown:', error);
                    process.exit(1);
                }
            };

            process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
            process.on('SIGINT', () => gracefulShutdown('SIGINT'));

            // Handle uncaught errors
            process.on('uncaughtException', (error) => {
                log.error('Uncaught Exception:', error);
                process.exit(1);
            });

            process.on('unhandledRejection', (reason, promise) => {
                log.error('Unhandled Rejection', { promise, reason });
                process.exit(1);
            });

        } catch (error) {
            log.error('Failed to start server:', error);
            process.exit(1);
        }
    }
}

const server = new Server();
server.start();