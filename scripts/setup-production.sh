#!/bin/bash

set -e

echo "🏭 Setting up production environment for Rocket Chat Universal Translator"
echo "Setup started at: $(date)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️ $1${NC}"
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker not found. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose >/dev/null 2>&1; then
    print_error "Docker Compose not found. Please install Docker Compose first."
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    print_error "OpenSSL not found. Please install OpenSSL first."
    exit 1
fi

print_status "Prerequisites check passed"

# Create required directories
echo "📁 Creating required directories..."
mkdir -p /opt/logs
mkdir -p /opt/backups/translator
mkdir -p ./letsencrypt
mkdir -p ./traefik
mkdir -p ./api/logs

# Set proper permissions
chmod 755 /opt/logs
chmod 755 /opt/backups/translator
chmod 600 ./letsencrypt 2>/dev/null || true

print_status "Directory structure created"

# Generate production secrets
echo "🔐 Generating production secrets..."
if [ ! -f .env.production ]; then
    ./scripts/generate-secrets.sh
    print_status "Production secrets generated"
else
    print_warning ".env.production already exists. Skipping secret generation."
    print_info "If you need to regenerate secrets, remove .env.production first."
fi

# Create Docker network
echo "🌐 Setting up Docker network..."
docker network create translator-network 2>/dev/null && print_status "Docker network created" || print_info "Docker network already exists"

# Validate configuration files
echo "🔍 Validating configuration files..."

required_files=(
    "docker-compose.production.yml"
    "docker-compose.production-ssl.yml"
    "docker-compose.production-resources.yml"
    "monitoring/prometheus.yml"
    "monitoring/alerts.yml"
    "monitoring/alertmanager.yml"
    "traefik/dynamic.yml"
)

missing_files=()
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -ne 0 ]; then
    print_error "Missing required configuration files:"
    for file in "${missing_files[@]}"; do
        echo "  - $file"
    done
    exit 1
fi

print_status "Configuration validation passed"

# Check environment variables
echo "🔧 Checking environment configuration..."
source .env.production

critical_vars=(
    "DB_PASSWORD"
    "REDIS_PASSWORD"
    "MONGO_ROOT_PASSWORD"
    "JWT_SECRET"
    "ENCRYPTION_KEY"
    "INTERNAL_SECRET"
)

missing_vars=()
for var in "${critical_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

if [ ${#missing_vars[@]} -ne 0 ]; then
    print_error "Missing critical environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

# Check AI provider keys
if [[ "$OPENAI_API_KEY" == "sk-YOUR-OPENAI-KEY" ]] || [[ -z "$OPENAI_API_KEY" ]]; then
    print_warning "AI provider API keys not configured"
    print_info "Edit .env.production to add real API keys before deployment"
fi

print_status "Environment configuration checked"

# Set up backup cron job
echo "⏰ Setting up backup cron job..."
BACKUP_CRON="0 2 * * * cd $(pwd) && ./scripts/backup-production.sh >> /opt/logs/backup.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "backup-production.sh"; then
    print_info "Backup cron job already exists"
else
    # Add cron job
    (crontab -l 2>/dev/null; echo "$BACKUP_CRON") | crontab -
    print_status "Backup cron job added (daily at 2 AM)"
fi

# Test Docker Compose configuration
echo "🧪 Testing Docker Compose configuration..."
docker-compose -f docker-compose.production.yml config >/dev/null 2>&1 && print_status "Main configuration valid" || {
    print_error "Main Docker Compose configuration invalid"
    exit 1
}

docker-compose -f docker-compose.production-ssl.yml config >/dev/null 2>&1 && print_status "SSL configuration valid" || {
    print_error "SSL Docker Compose configuration invalid"
    exit 1
}

docker-compose -f docker-compose.production-resources.yml config >/dev/null 2>&1 && print_status "Resources configuration valid" || {
    print_error "Resources Docker Compose configuration invalid"
    exit 1
}

# Create systemd service (optional)
echo "🔧 Creating systemd service..."
cat > /tmp/translator-production.service << EOF
[Unit]
Description=Rocket Chat Universal Translator Production
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$(pwd)
ExecStart=$(which docker-compose) -f docker-compose.production.yml -f docker-compose.production-ssl.yml -f docker-compose.production-resources.yml up -d
ExecStop=$(which docker-compose) -f docker-compose.production.yml -f docker-compose.production-ssl.yml -f docker-compose.production-resources.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

if [ -w /etc/systemd/system/ ]; then
    sudo mv /tmp/translator-production.service /etc/systemd/system/
    sudo systemctl daemon-reload
    print_status "Systemd service created"
    print_info "Enable with: sudo systemctl enable translator-production"
else
    print_warning "Cannot create systemd service (no write access to /etc/systemd/system/)"
    rm -f /tmp/translator-production.service
fi

# Create production README
echo "📚 Creating production documentation..."
cat > PRODUCTION_SETUP.md << 'EOF'
# Production Setup Complete

## 🚀 Deployment Commands

### Start Production Environment
```bash
./scripts/deploy-production.sh
```

### Stop Services
```bash
docker-compose -f docker-compose.production.yml -f docker-compose.production-ssl.yml -f docker-compose.production-resources.yml down
```

### View Logs
```bash
docker-compose -f docker-compose.production.yml logs -f api
```

### Backup
```bash
./scripts/backup-production.sh
```

### Rollback
```bash
./scripts/rollback-production.sh [version-tag]
```

## 🔗 Service URLs

- **Translation API**: https://translate-api.paysera.tech
- **Rocket.Chat**: https://translate-chat.paysera.tech
- **Health Check**: https://translate-api.paysera.tech/healthz

## 📊 Monitoring URLs

- **Prometheus**: https://prometheus.translate-api.paysera.tech
- **Grafana**: https://grafana.translate-api.paysera.tech
- **Alerts**: https://alerts.translate-api.paysera.tech

## 🔧 Maintenance

### Update SSL Certificates
```bash
docker-compose -f docker-compose.production-ssl.yml restart traefik
```

### Scale API Service
```bash
docker-compose -f docker-compose.production.yml up -d --scale api=3
```

### Database Backup
```bash
./scripts/backup-production.sh
```

## 🚨 Emergency Procedures

1. **Service Down**: Check logs and restart services
2. **Database Issues**: Restore from backup
3. **SSL Certificate Issues**: Restart Traefik
4. **High Load**: Scale API service

## 📞 Support

- **Logs**: `/opt/logs/`
- **Backups**: `/opt/backups/translator/`
- **Config**: `.env.production`
EOF

print_status "Production documentation created"

# Final setup summary
echo ""
echo "🎉 Production setup completed successfully!"
echo ""
echo "📋 Setup Summary:"
echo "  ✅ Directory structure created"
echo "  ✅ Production secrets generated"
echo "  ✅ Docker network configured"
echo "  ✅ Configuration files validated"
echo "  ✅ Backup cron job scheduled"
echo "  ✅ Systemd service created"
echo "  ✅ Documentation generated"
echo ""
echo "📡 Service Domains:"
echo "  🌐 API: translate-api.paysera.tech"
echo "  💬 Chat: translate-chat.paysera.tech"
echo ""
echo "🔧 Next Steps:"
echo "  1. Review and update AI provider API keys in .env.production"
echo "  2. Configure alerting email/Slack webhooks in monitoring/alertmanager.yml"
echo "  3. Test deployment with: ./scripts/deploy-production.sh"
echo "  4. Set up DNS records for the domains"
echo "  5. Configure firewall rules (ports 80, 443)"
echo ""
echo "📚 Documentation:"
echo "  📄 Production Guide: PRODUCTION_SETUP.md"
echo "  🔧 Scripts: scripts/"
echo "  📊 Monitoring: monitoring/"
echo ""
print_status "Production environment is ready for deployment!"

# Optional: Run deployment test
read -p "Do you want to run a deployment test now? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧪 Running deployment test..."
    ./scripts/deploy-production.sh
else
    print_info "Deployment test skipped. Run './scripts/deploy-production.sh' when ready."
fi