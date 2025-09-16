#!/bin/bash

# Rocket.Chat Universal Translator - Production Deployment Script
# This script deploys the translator to production environment

set -e

echo "🚀 Deploying Rocket.Chat Universal Translator to Production"
echo "==========================================================="

PROD_PATH="/opt/prod/services/rocketchat-translator"
DEV_PATH="/opt/dev/rocket-chat-universal-translator"

# 1. Create production directory
echo "📁 Setting up production directory..."
mkdir -p $PROD_PATH

# 2. Copy essential files
echo "📋 Copying production files..."
cp -r $DEV_PATH/api $PROD_PATH/
cp -r $DEV_PATH/plugin $PROD_PATH/
cp -r $DEV_PATH/shared $PROD_PATH/
cp $DEV_PATH/package.json $PROD_PATH/
cp $DEV_PATH/package-lock.json $PROD_PATH/
cp $DEV_PATH/docker-compose.production.yml $PROD_PATH/
cp $DEV_PATH/docker-compose.production-ssl.yml $PROD_PATH/
cp $DEV_PATH/docker-compose.production-resources.yml $PROD_PATH/
cp $DEV_PATH/.env.example $PROD_PATH/.env

# 3. Update production configuration
echo "⚙️ Configuring for production..."
cat > $PROD_PATH/.env << 'EOF'
NODE_ENV=production
PORT=8015

# API Configuration
API_URL=https://translate-api.paysera.tech

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=translator_prod
DB_USER=translator
DB_PASSWORD=CHANGE_THIS_SECURE_PASSWORD

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=CHANGE_THIS_SECURE_PASSWORD

# Rocket.Chat
ROCKETCHAT_URL=https://chat.paysera.com
ROCKETCHAT_ADMIN_USER=CHANGE_THIS
ROCKETCHAT_ADMIN_PASS=CHANGE_THIS

# AI Providers (Add your production keys)
OPENAI_API_KEY=sk-YOUR-OPENAI-KEY
ANTHROPIC_API_KEY=sk-ant-YOUR-ANTHROPIC-KEY
DEEPL_API_KEY=YOUR-DEEPL-KEY

# Security
JWT_SECRET=GENERATE_SECURE_SECRET
ENCRYPTION_KEY=GENERATE_SECURE_KEY
INTERNAL_SECRET=GENERATE_SECURE_SECRET

# CORS
ALLOWED_ORIGINS=https://chat.paysera.com,https://translate-api.paysera.tech
EOF

# 4. Build plugin for Rocket.Chat
echo "🔨 Building Rocket.Chat plugin..."
cd $PROD_PATH/plugin
npm install
npm run build
rc-apps package

echo "✅ Plugin packaged at: $PROD_PATH/plugin/dist/"
echo ""

# 5. Create docker-compose for production
cat > $PROD_PATH/docker-compose.yml << 'EOF'
version: '3.8'

services:
  translator-api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: translator-api-prod
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    ports:
      - "8015:8015"
    networks:
      - translator-network
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    container_name: translator-postgres-prod
    environment:
      POSTGRES_DB: translator_prod
      POSTGRES_USER: translator
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - translator-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: translator-redis-prod
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - translator-network
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  translator-network:
    driver: bridge
EOF

echo "==========================================================="
echo "✅ Production deployment prepared!"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Update environment variables in: $PROD_PATH/.env"
echo "   - Add your production API keys"
echo "   - Set secure passwords"
echo "   - Configure Rocket.Chat credentials"
echo ""
echo "2. Upload plugin to chat.paysera.com:"
echo "   - File: $PROD_PATH/plugin/dist/*.zip"
echo "   - Go to: Administration → Apps → Upload Private App"
echo ""
echo "3. Start production API:"
echo "   cd $PROD_PATH"
echo "   docker-compose up -d"
echo ""
echo "4. Configure DNS:"
echo "   - Point translate-api.paysera.tech to this server"
echo "   - Port: 8015"
echo ""
echo "5. Test the integration:"
echo "   - Create a test channel in Rocket.Chat"
echo "   - Enable the translator app"
echo "   - Send test messages"
echo ""
echo "🌐 Production URLs:"
echo "   API: https://translate-api.paysera.tech"
echo "   Rocket.Chat: https://chat.paysera.com"
echo "==========================================================="