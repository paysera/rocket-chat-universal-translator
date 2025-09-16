#!/bin/bash

echo "🔐 Generating production secrets..."

# Generate secure passwords
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Generate secure keys
generate_key() {
    openssl rand -hex 32
}

# Create .env.production
cat > .env.production << EOL
# PRODUCTION ENVIRONMENT - GENERATED $(date)
# ⚠️ KEEP THIS FILE SECURE - DO NOT COMMIT TO GIT

# Server Configuration
NODE_ENV=production
PORT=3001

# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=translator
DB_USER=translator
DB_PASSWORD=$(generate_password)

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(generate_password)

# MongoDB Configuration
MONGO_ROOT_USER=root
MONGO_ROOT_PASSWORD=$(generate_password)
MONGO_ROCKETCHAT_USER=rocketchat
MONGO_ROCKETCHAT_PASSWORD=$(generate_password)

# Rocket.Chat Configuration
ROCKETCHAT_URL=https://translate-chat.paysera.tech
ROCKETCHAT_ADMIN_USER=admin
ROCKETCHAT_ADMIN_PASS=$(generate_password)
ROCKETCHAT_ADMIN_EMAIL=admin@paysera.tech

# Security Keys
JWT_SECRET=$(generate_key)
JWT_EXPIRY=12h
ENCRYPTION_KEY=$(generate_key)
INTERNAL_SECRET=$(generate_key)

# CORS Configuration
ALLOWED_ORIGINS=https://translate-api.paysera.tech,https://translate-chat.paysera.tech

# AI Provider Keys (MUST BE SET MANUALLY)
OPENAI_API_KEY=sk-YOUR-OPENAI-KEY
ANTHROPIC_API_KEY=sk-ant-YOUR-ANTHROPIC-KEY
DEEPL_API_KEY=YOUR-DEEPL-KEY
GOOGLE_TRANSLATE_API_KEY=YOUR-GOOGLE-KEY
OPENROUTER_API_KEY=YOUR-OPENROUTER-KEY

# Logging
LOG_LEVEL=info
LOG_TO_CONSOLE=true
LOG_TO_FILE=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Monitoring
SENTRY_DSN=YOUR-SENTRY-DSN
NEW_RELIC_LICENSE_KEY=YOUR-NEW-RELIC-KEY

# SSL Certificate Configuration
LETSENCRYPT_EMAIL=devops@paysera.tech

# Traefik Configuration
TRAEFIK_API_DASHBOARD=false
TRAEFIK_API_INSECURE=false
EOL

# Add to .gitignore if not already there
if ! grep -q ".env.production" .gitignore; then
    echo ".env.production" >> .gitignore
    echo "✅ Added .env.production to .gitignore"
fi

echo "✅ Production secrets generated in .env.production"
echo ""
echo "⚠️ IMPORTANT ACTIONS REQUIRED:"
echo "1. Update AI provider API keys with real values"
echo "2. Store this file securely (e.g., HashiCorp Vault, AWS Secrets Manager)"
echo "3. Backup these credentials securely"
echo ""
echo "Generated passwords have been saved. DO NOT LOSE THEM!"
echo ""
echo "🔒 Security reminder:"
echo "- Never commit .env.production to version control"
echo "- Store backups encrypted"
echo "- Rotate credentials regularly"
echo "- Use environment-specific secrets in production"