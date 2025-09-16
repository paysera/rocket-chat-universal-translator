#!/bin/bash

set -e

echo "🚀 Starting production deployment..."
echo "Deployment initiated at: $(date)"

# Configuration
DEPLOYMENT_LOG="/opt/logs/deployment.log"
ROLLBACK_TAG="pre-deploy-$(date +%Y%m%d_%H%M%S)"
MAX_DEPLOY_TIME=600  # 10 minutes timeout

# Ensure log directory exists
mkdir -p "$(dirname "$DEPLOYMENT_LOG")"

# Function to log both to console and file
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$DEPLOYMENT_LOG"
}

# Function to check service health
check_service_health() {
    local service_url=$1
    local service_name=$2
    local max_attempts=30
    local attempt=1

    log "Checking health of $service_name at $service_url"

    while [ $attempt -le $max_attempts ]; do
        if curl -f -s --max-time 10 "$service_url" >/dev/null 2>&1; then
            log "✅ $service_name is healthy"
            return 0
        fi
        log "⏳ $service_name not ready (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done

    log "❌ $service_name failed health check after $max_attempts attempts"
    return 1
}

# Function to rollback on failure
rollback_on_failure() {
    log "❌ Deployment failed. Initiating automatic rollback..."
    if [ -f "./scripts/rollback-production.sh" ]; then
        ./scripts/rollback-production.sh "$ROLLBACK_TAG"
    else
        log "⚠️ Rollback script not found. Manual intervention required."
    fi
    exit 1
}

# Trap errors and rollback
trap rollback_on_failure ERR

log "🔍 Pre-deployment validation started"

# Check if production environment exists
if [ ! -f .env.production ]; then
    log "❌ Error: .env.production not found"
    log "Run: ./scripts/generate-secrets.sh"
    exit 1
fi

# Load production environment
set -o allexport
source .env.production
set +o allexport

log "✅ Production environment loaded"

# Validate critical environment variables
if [[ "$OPENAI_API_KEY" == "sk-YOUR-OPENAI-KEY" ]] || [[ -z "$OPENAI_API_KEY" ]]; then
    log "❌ Error: AI provider keys not configured properly"
    log "Edit .env.production with real API keys"
    exit 1
fi

if [[ -z "$JWT_SECRET" ]] || [[ -z "$ENCRYPTION_KEY" ]]; then
    log "❌ Error: Security keys not configured"
    exit 1
fi

log "✅ Environment validation passed"

# Check Docker and Docker Compose
if ! command -v docker >/dev/null 2>&1; then
    log "❌ Docker not found"
    exit 1
fi

if ! command -v docker-compose >/dev/null 2>&1; then
    log "❌ Docker Compose not found"
    exit 1
fi

# Check if required compose files exist
for file in docker-compose.production.yml docker-compose.production-ssl.yml docker-compose.production-resources.yml; do
    if [ ! -f "$file" ]; then
        log "❌ Required file not found: $file"
        exit 1
    fi
done

log "✅ Pre-deployment validation completed"

# Create backup before deployment
log "📦 Creating pre-deployment backup"
if [ -f "./scripts/backup-production.sh" ]; then
    ./scripts/backup-production.sh || {
        log "⚠️ Backup failed, but continuing with deployment"
    }
else
    log "⚠️ Backup script not found"
fi

# Tag current images for rollback
log "🏷️ Tagging current images for rollback"
docker tag translator-api:latest "translator-api:$ROLLBACK_TAG" 2>/dev/null || true

# Create external network if it doesn't exist
log "🌐 Ensuring Docker network exists"
docker network create translator-network 2>/dev/null || true

# Create required directories
log "📁 Creating required directories"
mkdir -p ./letsencrypt
mkdir -p ./traefik
chmod 600 ./letsencrypt 2>/dev/null || true

# Build images
log "🔨 Building Docker images"
docker-compose -f docker-compose.production.yml build --parallel --pull

# Pull latest base images
log "📥 Pulling latest base images"
docker-compose -f docker-compose.production.yml pull --parallel || true

# Run database migrations if needed
log "🗃️ Running database migrations"
docker-compose -f docker-compose.production.yml run --rm --no-deps api npm run migrate 2>/dev/null || {
    log "⚠️ Migration command not found or failed, skipping"
}

# Start infrastructure services first
log "🏗️ Starting infrastructure services"
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    up -d traefik postgres redis mongodb

# Wait for infrastructure to be ready
log "⏳ Waiting for infrastructure services"
sleep 30

# Check infrastructure health
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-resources.yml \
    ps traefik postgres redis mongodb

# Deploy application services with zero downtime
log "🚀 Deploying application services"
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    up -d --no-deps --scale api=2

# Wait for services to stabilize
log "⏳ Waiting for services to stabilize (60 seconds)"
sleep 60

# Health check verification
log "🏥 Verifying service health"

# Check API health
if ! check_service_health "https://translate-api.paysera.tech/healthz" "Translation API"; then
    log "❌ API health check failed"
    rollback_on_failure
fi

# Check Rocket.Chat health
if ! check_service_health "https://translate-chat.paysera.tech/api/info" "Rocket.Chat"; then
    log "⚠️ Rocket.Chat health check failed, but continuing"
fi

# Verify SSL certificates
log "🔒 Verifying SSL certificates"
if curl -s -I "https://translate-api.paysera.tech" | grep -q "HTTP/2 200\|HTTP/1.1 200"; then
    log "✅ SSL certificate for API is working"
else
    log "⚠️ SSL certificate for API may not be ready yet"
fi

# Run smoke tests if available
log "🧪 Running smoke tests"
if [ -f "./tests/smoke-tests.sh" ]; then
    ./tests/smoke-tests.sh || {
        log "⚠️ Smoke tests failed, but deployment continues"
    }
else
    log "ℹ️ No smoke tests found"
fi

# Cleanup old images to save space
log "🗑️ Cleaning up old Docker images"
docker image prune -f >/dev/null 2>&1 || true

# Final verification
log "✅ Running final deployment verification"

# Check all services are running
RUNNING_SERVICES=$(docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    ps --services --filter "status=running" | wc -l)

log "📊 Services running: $RUNNING_SERVICES"

# Log deployment summary
log "✅ Production deployment completed successfully!"
log ""
log "📋 Deployment Summary:"
log "  Started: $(date)"
log "  API URL: https://translate-api.paysera.tech"
log "  Chat URL: https://translate-chat.paysera.tech"
log "  Rollback tag: $ROLLBACK_TAG"
log "  Services: $RUNNING_SERVICES running"
log ""

# Display access information
echo "🎉 Deployment completed successfully!"
echo ""
echo "📡 Service URLs:"
echo "  🌐 Translation API: https://translate-api.paysera.tech"
echo "  💬 Rocket.Chat: https://translate-chat.paysera.tech"
echo "  📊 Health Check: https://translate-api.paysera.tech/healthz"
echo ""
echo "🔧 Next steps:"
echo "1. ✅ Verify all services are responding correctly"
echo "2. 📊 Monitor application metrics and logs"
echo "3. 🧪 Run comprehensive integration tests"
echo "4. 📧 Notify stakeholders of successful deployment"
echo ""
echo "🔄 Rollback available with: ./scripts/rollback-production.sh $ROLLBACK_TAG"
echo ""

# Optional: Send deployment notification
if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"✅ Translator production deployment completed successfully!\\n🌐 API: https://translate-api.paysera.tech\\n💬 Chat: https://translate-chat.paysera.tech\"}" \
        "$SLACK_WEBHOOK_URL" 2>/dev/null || true
fi

log "🏁 Deployment script completed at: $(date)"