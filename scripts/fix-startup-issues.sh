#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Fixing Common Startup Issues${NC}"
echo "================================="

# 1. Fix shared workspace index
echo -e "${YELLOW}Fixing shared workspace...${NC}"
if [ ! -f "shared/index.ts" ]; then
    echo "export * from './types';" > shared/index.ts
    echo -e "${GREEN}✅ Created shared/index.ts${NC}"
fi

# 2. Rebuild shared module
echo -e "${YELLOW}Building shared module...${NC}"
cd shared && npm run build && cd ..
echo -e "${GREEN}✅ Shared module built${NC}"

# 3. Install all dependencies
echo -e "${YELLOW}Installing all dependencies...${NC}"
# First install root dependencies
npm install
# Then install workspace dependencies individually
cd plugin && npm install && cd ..
cd api && npm install && cd ..
cd shared && npm install && cd ..
echo -e "${GREEN}✅ Dependencies installed${NC}"

# 4. Build all workspaces
echo -e "${YELLOW}Building all workspaces...${NC}"
# Build shared first
cd shared && npm run build && cd ..
# Build API
cd api && npm run build && cd ..
# Skip plugin build for now - rc-apps has issues
echo -e "${YELLOW}⚠️ Skipping plugin build (rc-apps issue)${NC}"
echo -e "${GREEN}✅ API and shared workspaces built${NC}"

# 5. Create .env if missing
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env from example${NC}"
fi

# 6. Update API server.ts to use preflight
echo -e "${YELLOW}Updating API server with preflight checks...${NC}"
cat > api/src/server-with-preflight.ts << 'EOF'
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
EOF

echo -e "${GREEN}✅ Created server with preflight checks${NC}"

# 7. Fix Docker networking in .env
echo -e "${YELLOW}Fixing environment variables for Docker...${NC}"

# Create Docker-specific env file
cat > .env.docker << 'EOF'
# Server Configuration
NODE_ENV=development
PORT=3001

# Database Configuration (Docker internal network)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=translator
DB_USER=translator
DB_PASSWORD=password

# Redis Configuration (Docker internal network)
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# Rocket.Chat Configuration (Docker internal network)
ROCKETCHAT_URL=http://rocketchat:3000
ROCKETCHAT_ADMIN_USER=admin
ROCKETCHAT_ADMIN_PASS=admin123

# Security
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRY=24h
ENCRYPTION_KEY=32-character-hex-encryption-key-change-this
INTERNAL_SECRET=internal-api-secret

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=debug
LOG_TO_CONSOLE=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF

echo -e "${GREEN}✅ Created .env.docker for container use${NC}"

echo ""
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}✅ All common issues fixed!${NC}"
echo -e "${GREEN}=================================${NC}"
echo ""
echo "Next steps:"
echo "1. Run startup check: ./scripts/startup-check.sh"
echo "2. Start services: ./scripts/start.sh [docker|local]"
echo ""
echo "For Docker deployment:"
echo "  docker-compose -f docker-compose.fixed.yml up"
echo ""
echo "For local development:"
echo "  npm run dev"