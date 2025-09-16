import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { preflight } from './config/env-validator';
import healthRoutes from './routes/health';

async function startServer() {
  try {
    // Run preflight checks
    const config = await preflight();

    // Create Express app
    const app = express();

    // Middleware
    app.use(helmet());
    app.use(cors({
      origin: config.ALLOWED_ORIGINS.split(','),
      credentials: true
    }));
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Health check routes
    app.use('/', healthRoutes);

    // API routes
    app.get('/', (req, res) => {
      res.json({
        name: 'Universal Translator API',
        version: '1.0.0',
        status: 'running',
        environment: config.NODE_ENV
      });
    });

    // Error handling
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        environment: config.NODE_ENV === 'development' ? err.stack : undefined
      });
    });

    // Start server
    app.listen(config.PORT, () => {
      console.log(`✅ API Server running on port ${config.PORT}`);
      console.log(`   Health check: http://localhost:${config.PORT}/healthz`);
      console.log(`   Ready check: http://localhost:${config.PORT}/readyz`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();
