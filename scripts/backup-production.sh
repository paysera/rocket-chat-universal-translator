#!/bin/bash

set -e

BACKUP_DIR="/opt/backups/translator"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

echo "🔄 Starting production backup at $(date)..."

# Create backup directory
mkdir -p "$BACKUP_PATH"

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production not found"
    echo "Run: ./scripts/generate-secrets.sh first"
    exit 1
fi

# Load production environment
set -o allexport
source .env.production
set +o allexport

echo "📊 Backup configuration:"
echo "  Target: $BACKUP_PATH"
echo "  Database: $DB_NAME"
echo "  Retention: 7 days"

# Function to log backup steps
log_step() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Backup PostgreSQL
log_step "Backing up PostgreSQL database..."
if docker exec translator-postgres pg_dump \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-owner \
    --no-acl \
    --compress=9 \
    --verbose > "$BACKUP_PATH/postgres_backup.sql" 2>/dev/null; then
    log_step "✅ PostgreSQL backup completed"
else
    log_step "❌ PostgreSQL backup failed"
    exit 1
fi

# Backup Redis
log_step "Backing up Redis data..."
if docker exec translator-redis redis-cli --pass "$REDIS_PASSWORD" BGSAVE > /dev/null 2>&1; then
    # Wait for background save to complete
    sleep 10

    if docker cp translator-redis:/data/dump.rdb "$BACKUP_PATH/redis_backup.rdb" 2>/dev/null; then
        log_step "✅ Redis backup completed"
    else
        log_step "⚠️ Redis backup failed, but continuing..."
    fi
else
    log_step "⚠️ Redis BGSAVE failed, but continuing..."
fi

# Backup MongoDB
log_step "Backing up MongoDB data..."
if docker exec translator-mongo mongodump \
    --username="$MONGO_ROOT_USER" \
    --password="$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase=admin \
    --gzip \
    --out=/tmp/mongo_backup > /dev/null 2>&1; then

    if docker cp translator-mongo:/tmp/mongo_backup "$BACKUP_PATH/" 2>/dev/null; then
        docker exec translator-mongo rm -rf /tmp/mongo_backup 2>/dev/null
        log_step "✅ MongoDB backup completed"
    else
        log_step "❌ MongoDB backup copy failed"
        exit 1
    fi
else
    log_step "❌ MongoDB backup failed"
    exit 1
fi

# Backup application configuration and logs
log_step "Backing up application files..."
mkdir -p "$BACKUP_PATH/config"

# Backup environment file (without secrets)
grep -v "PASSWORD\|SECRET\|KEY" .env.production > "$BACKUP_PATH/config/env_template" || true

# Backup docker-compose files
cp docker-compose.*.yml "$BACKUP_PATH/config/" 2>/dev/null || true

# Backup recent logs if they exist
if [ -d "./api/logs" ]; then
    cp -r ./api/logs "$BACKUP_PATH/logs" 2>/dev/null || true
fi

log_step "✅ Application files backup completed"

# Create backup metadata
cat > "$BACKUP_PATH/backup_info.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname)",
  "backup_type": "full",
  "databases": {
    "postgresql": "$DB_NAME",
    "mongodb": "rocketchat",
    "redis": "cache"
  },
  "retention_days": 7,
  "compressed": false
}
EOF

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
log_step "📦 Backup size: $BACKUP_SIZE"

# Compress backup
log_step "Compressing backup..."
if tar -czf "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP" 2>/dev/null; then
    rm -rf "$BACKUP_PATH"
    COMPRESSED_SIZE=$(du -sh "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" | cut -f1)
    log_step "✅ Backup compressed to $COMPRESSED_SIZE"
else
    log_step "❌ Backup compression failed"
    exit 1
fi

# Cleanup old backups (keep last 7 days)
log_step "Cleaning up old backups..."
OLD_BACKUPS=$(find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -type f | wc -l | xargs)
if [ "$OLD_BACKUPS" -gt 0 ]; then
    find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -type f -delete
    log_step "🗑️ Removed $OLD_BACKUPS old backup(s)"
else
    log_step "ℹ️ No old backups to clean"
fi

# Final backup verification
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"
if [ -f "$BACKUP_FILE" ]; then
    log_step "✅ Backup completed successfully: $BACKUP_FILE"

    # Log backup summary
    echo ""
    echo "📋 Backup Summary:"
    echo "  File: $BACKUP_FILE"
    echo "  Size: $COMPRESSED_SIZE"
    echo "  Components: PostgreSQL, MongoDB, Redis, Config"
    echo "  Retention: 7 days"
    echo ""

    # Optional: Upload to remote storage (uncomment and configure as needed)
    # if command -v aws >/dev/null 2>&1; then
    #     log_step "📤 Uploading to S3..."
    #     aws s3 cp "$BACKUP_FILE" "s3://paysera-backups/translator/" --storage-class STANDARD_IA
    #     log_step "✅ S3 upload completed"
    # fi

    # Optional: Send notification (uncomment and configure as needed)
    # if [ ! -z "$SLACK_WEBHOOK_URL" ]; then
    #     curl -X POST -H 'Content-type: application/json' \
    #         --data "{\"text\":\"✅ Translator backup completed: $COMPRESSED_SIZE\"}" \
    #         "$SLACK_WEBHOOK_URL" 2>/dev/null || true
    # fi

    exit 0
else
    log_step "❌ Backup file not found after compression"
    exit 1
fi