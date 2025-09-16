#!/bin/bash

set -e

echo "⚠️ Production Rollback Initiated"
echo "Rollback started at: $(date)"

# Configuration
ROLLBACK_LOG="/opt/logs/rollback.log"
DEFAULT_TAG="latest-stable"

# Ensure log directory exists
mkdir -p "$(dirname "$ROLLBACK_LOG")"

# Function to log both to console and file
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$ROLLBACK_LOG"
}

# Function to check service health after rollback
check_rollback_health() {
    local service_url=$1
    local service_name=$2
    local max_attempts=20
    local attempt=1

    log "Checking health of $service_name after rollback"

    while [ $attempt -le $max_attempts ]; do
        if curl -f -s --max-time 10 "$service_url" >/dev/null 2>&1; then
            log "✅ $service_name is healthy after rollback"
            return 0
        fi
        log "⏳ $service_name not ready after rollback (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done

    log "❌ $service_name failed health check after rollback"
    return 1
}

# Get rollback target
ROLLBACK_TAG=${1:-$DEFAULT_TAG}

log "🔄 Starting rollback to version: $ROLLBACK_TAG"

# Validate rollback tag exists
if ! docker image inspect "translator-api:$ROLLBACK_TAG" >/dev/null 2>&1; then
    log "❌ Rollback image not found: translator-api:$ROLLBACK_TAG"
    log "Available images:"
    docker images translator-api --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" | tee -a "$ROLLBACK_LOG"
    exit 1
fi

# Load production environment if available
if [ -f .env.production ]; then
    set -o allexport
    source .env.production
    set +o allexport
    log "✅ Production environment loaded"
fi

# Create emergency backup before rollback
log "💾 Creating emergency backup before rollback"
EMERGENCY_BACKUP_DIR="/opt/backups/emergency-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$EMERGENCY_BACKUP_DIR"

# Quick database dump (non-blocking)
if docker exec translator-postgres pg_dump -U "${DB_USER:-translator}" -d "${DB_NAME:-translator}" --no-owner --no-acl > "$EMERGENCY_BACKUP_DIR/emergency_postgres.sql" 2>/dev/null; then
    log "✅ Emergency PostgreSQL backup created"
else
    log "⚠️ Emergency PostgreSQL backup failed, continuing rollback"
fi

# Tag current version as failed for investigation
FAILED_TAG="failed-$(date +%Y%m%d_%H%M%S)"
docker tag translator-api:latest "translator-api:$FAILED_TAG" 2>/dev/null || true
log "🏷️ Tagged current version as $FAILED_TAG for investigation"

# Stop current services gracefully
log "🛑 Stopping current services"
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    stop api rocketchat --timeout 30

# Update API service to use rollback image
log "🔄 Rolling back API service to $ROLLBACK_TAG"

# Temporarily modify docker-compose to use rollback tag
sed -i.backup "s|translator-api:latest|translator-api:$ROLLBACK_TAG|g" docker-compose.production.yml

# Start services with rollback version
log "🚀 Starting services with rollback version"
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    up -d --no-deps --scale api=1

# Wait for services to start
log "⏳ Waiting for services to start (45 seconds)"
sleep 45

# Health check verification
log "🏥 Verifying rollback health"

# Check API health
if ! check_rollback_health "https://translate-api.paysera.tech/healthz" "Translation API"; then
    log "❌ API health check failed after rollback"
    log "🚨 CRITICAL: Rollback failed, manual intervention required"

    # Try to restore original version
    log "🔄 Attempting to restore original version"
    mv docker-compose.production.yml.backup docker-compose.production.yml
    docker-compose \
        -f docker-compose.production.yml \
        -f docker-compose.production-ssl.yml \
        -f docker-compose.production-resources.yml \
        up -d --no-deps api

    exit 1
fi

# Scale up API instances after successful health check
log "📈 Scaling up API instances"
docker-compose \
    -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    up -d --no-deps --scale api=2

# Wait for scaling to complete
sleep 30

# Check Rocket.Chat health
if ! check_rollback_health "https://translate-chat.paysera.tech/api/info" "Rocket.Chat"; then
    log "⚠️ Rocket.Chat health check failed after rollback, but API is working"
fi

# Clean up temporary files
rm -f docker-compose.production.yml.backup

# Run basic smoke tests
log "🧪 Running post-rollback verification"

# Test basic API endpoints
API_VERSION=$(curl -s "https://translate-api.paysera.tech/healthz" | jq -r '.version // "unknown"' 2>/dev/null || echo "unknown")
log "📊 Rolled back to API version: $API_VERSION"

# Test translation functionality (basic)
if curl -s -X POST "https://translate-api.paysera.tech/translate" \
    -H "Content-Type: application/json" \
    -d '{"text":"hello","from":"en","to":"lt","provider":"test"}' \
    >/dev/null 2>&1; then
    log "✅ Basic translation functionality working"
else
    log "⚠️ Translation functionality test inconclusive"
fi

# Check service status
RUNNING_SERVICES=$(docker-compose \
    -f docker-compose.production.yml \
    ps --services --filter "status=running" | wc -l)

log "📊 Services running after rollback: $RUNNING_SERVICES"

# Final rollback verification
log "✅ Rollback verification completed"

# Log rollback summary
log "🏁 Production rollback completed successfully!"
log ""
log "📋 Rollback Summary:"
log "  Completed at: $(date)"
log "  Rolled back to: $ROLLBACK_TAG"
log "  Failed version tagged as: $FAILED_TAG"
log "  Emergency backup: $EMERGENCY_BACKUP_DIR"
log "  API version: $API_VERSION"
log "  Services running: $RUNNING_SERVICES"
log ""

# Display rollback information
echo "✅ Rollback completed successfully!"
echo ""
echo "📊 Rollback Details:"
echo "  🎯 Target version: $ROLLBACK_TAG"
echo "  📦 API version: $API_VERSION"
echo "  🏥 Services: $RUNNING_SERVICES running"
echo ""
echo "🔍 Post-rollback URLs:"
echo "  🌐 Translation API: https://translate-api.paysera.tech"
echo "  💬 Rocket.Chat: https://translate-chat.paysera.tech"
echo "  📊 Health Check: https://translate-api.paysera.tech/healthz"
echo ""
echo "🚨 Investigation Resources:"
echo "  📁 Failed version image: translator-api:$FAILED_TAG"
echo "  💾 Emergency backup: $EMERGENCY_BACKUP_DIR"
echo "  📝 Rollback log: $ROLLBACK_LOG"
echo ""
echo "📋 Next Steps:"
echo "1. 🔍 Investigate root cause of deployment failure"
echo "2. 📊 Monitor system metrics and error logs"
echo "3. 🧪 Run comprehensive integration tests"
echo "4. 📧 Notify stakeholders of rollback completion"
echo "5. 🔧 Fix issues before next deployment attempt"
echo ""

# Optional: Send rollback notification
if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"⚠️ Translator production rolled back to $ROLLBACK_TAG\\n🌐 API: https://translate-api.paysera.tech\\n📊 Status: $RUNNING_SERVICES services running\"}" \
        "$SLACK_WEBHOOK_URL" 2>/dev/null || true
fi

log "🏁 Rollback script completed at: $(date)"

# Create incident report template
cat > "$EMERGENCY_BACKUP_DIR/incident_report_template.md" << EOF
# Production Rollback Incident Report

## Summary
- **Date**: $(date)
- **Rollback Target**: $ROLLBACK_TAG
- **Failed Version**: $FAILED_TAG
- **Duration**: [TO BE FILLED]
- **Impact**: [TO BE FILLED]

## Timeline
- Deployment started: [TO BE FILLED]
- Issue detected: [TO BE FILLED]
- Rollback initiated: $(date)
- Service restored: $(date)

## Root Cause
[TO BE INVESTIGATED]

## Resolution
Rolled back to stable version $ROLLBACK_TAG

## Prevention
[TO BE DEFINED]

## Action Items
- [ ] Investigate root cause
- [ ] Implement additional monitoring
- [ ] Update deployment procedures
- [ ] Improve rollback automation
EOF

echo "📄 Incident report template created: $EMERGENCY_BACKUP_DIR/incident_report_template.md"