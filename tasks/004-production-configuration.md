# UŽDUOTIS #004: Sukonfigūruoti production aplinką

## 🟡 PRIORITETAS: AUKŠTAS
**Terminas**: 2-3 dienos
**Laikas**: ~4-5 valandos
**Blokuoja**: Production deployment

## 📋 Problema

Production aplinka nėra paruošta:
- Naudojami default/test slaptažodžiai
- Nėra SSL/TLS konfigūracijos
- Trūksta secrets management
- Nėra backup strategijos
- Resource limits nesukonfigūruoti

## 🎯 Kodėl tai kritiškai svarbu?

1. **Saugumas**: Default kredencialai yra saugumo spraga
2. **GDPR/Compliance**: Paysera turi griežtus reikalavimus
3. **Data protection**: Be backup galima prarasti duomenis
4. **Performance**: Be resource limits servisai gali crash'inti
5. **Availability**: Be HA konfigūracijos bus downtime

## 🔧 Kaip taisyti

### Žingsnis 1: Sukurti production secrets

```bash
cd /opt/dev/rocket-chat-universal-translator

# Sukurti secrets generation script
cat > scripts/generate-secrets.sh << 'EOF'
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
EOL

echo "✅ Production secrets generated in .env.production"
echo ""
echo "⚠️ IMPORTANT ACTIONS REQUIRED:"
echo "1. Update AI provider API keys with real values"
echo "2. Store this file securely (e.g., HashiCorp Vault, AWS Secrets Manager)"
echo "3. Add .env.production to .gitignore"
echo "4. Backup these credentials securely"
echo ""
echo "Generated passwords have been saved. DO NOT LOSE THEM!"
EOF

chmod +x scripts/generate-secrets.sh
./scripts/generate-secrets.sh
```

### Žingsnis 2: Sukurti SSL/TLS konfigūraciją su Traefik

```bash
cat > docker-compose.production-ssl.yml << 'EOF'
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    container_name: translator-traefik
    restart: always
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=devops@paysera.tech"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--log.level=INFO"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - translator-network

  # Update API service labels
  api:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`translate-api.paysera.tech`)"
      - "traefik.http.routers.api.entrypoints=websecure"
      - "traefik.http.routers.api.tls=true"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      - "traefik.http.services.api.loadbalancer.server.port=3001"
      - "traefik.http.middlewares.api-ratelimit.ratelimit.average=100"
      - "traefik.http.middlewares.api-ratelimit.ratelimit.burst=50"
      - "traefik.http.routers.api.middlewares=api-ratelimit"

  # Update Rocket.Chat labels
  rocketchat:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.rocketchat.rule=Host(`translate-chat.paysera.tech`)"
      - "traefik.http.routers.rocketchat.entrypoints=websecure"
      - "traefik.http.routers.rocketchat.tls=true"
      - "traefik.http.routers.rocketchat.tls.certresolver=letsencrypt"
      - "traefik.http.services.rocketchat.loadbalancer.server.port=3000"
EOF
```

### Žingsnis 3: Pridėti resource limits ir health checks

```bash
cat > docker-compose.production-resources.yml << 'EOF'
version: '3.8'

services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    restart: unless-stopped
    command: >
      postgres
      -c max_connections=200
      -c shared_buffers=256MB
      -c effective_cache_size=1GB
      -c maintenance_work_mem=64MB
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200

  redis:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    restart: unless-stopped
    command: >
      redis-server
      --maxmemory 400mb
      --maxmemory-policy allkeys-lru
      --save 900 1
      --save 300 10
      --save 60 10000
      --appendonly yes
      --appendfsync everysec

  mongodb:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    restart: unless-stopped
    command: >
      mongod
      --wiredTigerCacheSizeGB 1.5
      --oplogSize 1024
EOF
```

### Žingsnis 4: Sukurti backup strategiją

```bash
cat > scripts/backup-production.sh << 'EOF'
#!/bin/bash

set -e

BACKUP_DIR="/opt/backups/translator"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

echo "🔄 Starting production backup..."

# Create backup directory
mkdir -p "$BACKUP_PATH"

# Load production environment
source .env.production

# Backup PostgreSQL
echo "Backing up PostgreSQL..."
docker exec translator-postgres pg_dump \
    -U $DB_USER \
    -d $DB_NAME \
    --no-owner \
    --no-acl \
    -f /tmp/postgres_backup.sql

docker cp translator-postgres:/tmp/postgres_backup.sql "$BACKUP_PATH/"
docker exec translator-postgres rm /tmp/postgres_backup.sql

# Backup Redis
echo "Backing up Redis..."
docker exec translator-redis redis-cli BGSAVE
sleep 5
docker cp translator-redis:/data/dump.rdb "$BACKUP_PATH/redis_backup.rdb"

# Backup MongoDB
echo "Backing up MongoDB..."
docker exec translator-mongo mongodump \
    --username=$MONGO_ROOT_USER \
    --password=$MONGO_ROOT_PASSWORD \
    --authenticationDatabase=admin \
    --out=/tmp/mongo_backup

docker cp translator-mongo:/tmp/mongo_backup "$BACKUP_PATH/"
docker exec translator-mongo rm -rf /tmp/mongo_backup

# Compress backup
echo "Compressing backup..."
tar -czf "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" -C "$BACKUP_DIR" "$TIMESTAMP"
rm -rf "$BACKUP_PATH"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete

echo "✅ Backup completed: $BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

# Upload to S3 (optional)
# aws s3 cp "$BACKUP_DIR/backup_$TIMESTAMP.tar.gz" s3://paysera-backups/translator/
EOF

chmod +x scripts/backup-production.sh

# Add to crontab for daily backups
echo "0 2 * * * /opt/dev/rocket-chat-universal-translator/scripts/backup-production.sh" | crontab -
```

### Žingsnis 5: Sukurti monitoring ir alerting

```bash
cat > monitoring/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: 'translator-api'
    static_configs:
      - targets: ['translator-api:3001']
    metrics_path: '/metrics'

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'mongodb'
    static_configs:
      - targets: ['mongodb-exporter:9216']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
EOF

cat > monitoring/alerts.yml << 'EOF'
groups:
  - name: translator_alerts
    interval: 30s
    rules:
      - alert: APIDown
        expr: up{job="translator-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "API is down"
          description: "Translator API has been down for more than 1 minute"

      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is above 90%"

      - alert: DatabaseDown
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"

      - alert: HighResponseTime
        expr: http_request_duration_seconds{quantile="0.95"} > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High API response time"
          description: "95th percentile response time is above 2 seconds"
EOF
```

### Žingsnis 6: Sukurti deployment script

```bash
cat > scripts/deploy-production.sh << 'EOF'
#!/bin/bash

set -e

echo "🚀 Deploying to production..."

# Pre-deployment checks
echo "Running pre-deployment checks..."

# Check if production secrets exist
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production not found"
    echo "Run: ./scripts/generate-secrets.sh"
    exit 1
fi

# Load production environment
source .env.production

# Check if AI keys are set
if [[ "$OPENAI_API_KEY" == "sk-YOUR-OPENAI-KEY" ]]; then
    echo "❌ Error: AI provider keys not configured"
    echo "Edit .env.production with real API keys"
    exit 1
fi

# Build images
echo "Building Docker images..."
docker-compose -f docker-compose.production.yml build

# Run database migrations
echo "Running database migrations..."
docker-compose -f docker-compose.production.yml run --rm api npm run migrate

# Deploy with zero downtime
echo "Deploying services..."
docker-compose -f docker-compose.production.yml \
    -f docker-compose.production-ssl.yml \
    -f docker-compose.production-resources.yml \
    up -d --no-deps --scale api=2

# Wait for health checks
echo "Waiting for services to be healthy..."
sleep 30

# Verify deployment
echo "Verifying deployment..."
curl -f https://translate-api.paysera.tech/healthz || {
    echo "❌ Deployment verification failed"
    exit 1
}

echo "✅ Production deployment completed successfully!"
echo ""
echo "Access URLs:"
echo "  API: https://translate-api.paysera.tech"
echo "  Chat: https://translate-chat.paysera.tech"
echo ""
echo "Next steps:"
echo "1. Verify all services are healthy"
echo "2. Run smoke tests"
echo "3. Monitor logs and metrics"
echo "4. Set up backup cron job"
EOF

chmod +x scripts/deploy-production.sh
```

### Žingsnis 7: Sukurti rollback strategiją

```bash
cat > scripts/rollback-production.sh << 'EOF'
#!/bin/bash

echo "⚠️ Rolling back production deployment..."

# Get previous image tags
PREVIOUS_TAG=${1:-"latest-stable"}

# Rollback to previous version
docker-compose -f docker-compose.production.yml \
    pull --quiet

docker-compose -f docker-compose.production.yml \
    up -d --no-deps \
    --scale api=2 \
    translator-api:$PREVIOUS_TAG

echo "✅ Rollback completed to version: $PREVIOUS_TAG"
EOF

chmod +x scripts/rollback-production.sh
```

## ✅ Sėkmės kriterijai

- [ ] Production secrets sugeneruoti ir saugiai saugomi
- [ ] SSL/TLS sertifikatai veikia
- [ ] Resource limits sukonfigūruoti
- [ ] Backup strategija įgyvendinta
- [ ] Monitoring ir alerting veikia
- [ ] Zero-downtime deployment veikia
- [ ] Rollback procedūra testuota

## ⚠️ Galimos problemos

1. **SSL certificate generation**: Let's Encrypt gali nepavykti
   - Sprendimas: Patikrinti DNS, naudoti staging environment

2. **Resource limits per maži**: Servisai gali crash'inti
   - Sprendimas: Stebėti metrics ir adjust limits

3. **Backup storage**: Gali pritrūkti vietos
   - Sprendimas: Konfigūruoti S3 arba external storage

4. **Database migration failures**: Production schema gali skirtis
   - Sprendimas: Backup prieš migrations, test staging

## 📚 Papildomi resursai

- [Docker Compose in production](https://docs.docker.com/compose/production/)
- [Traefik documentation](https://doc.traefik.io/traefik/)
- [PostgreSQL backup strategies](https://www.postgresql.org/docs/current/backup.html)

## 📝 Pastabos

Po šios užduoties atlikimo:
1. Sukonfigūruoti CI/CD pipeline su GitHub Actions
2. Įdiegti centralized logging (ELK stack)
3. Sukonfigūruoti disaster recovery plan
4. Atlikti security audit ir penetration testing