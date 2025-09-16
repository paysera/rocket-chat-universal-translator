# 🚀 Deployment Guide

## Pre-Deployment Checklist

### Development Complete
- [ ] All Phase 1-5 tasks completed
- [ ] Code review passed
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Performance benchmarks met

### Infrastructure Ready
- [ ] Production servers provisioned
- [ ] SSL certificates configured
- [ ] Database backups configured
- [ ] Monitoring setup complete
- [ ] Logging aggregation ready

### Security Validated
- [ ] Security audit completed
- [ ] Penetration testing passed
- [ ] API keys encrypted
- [ ] Rate limiting configured
- [ ] CORS properly configured

## Deployment Environments

### Development
```yaml
Environment: development
URL: https://dev.translator.noreika.lt
Database: PostgreSQL (Docker)
Cache: Redis (Docker)
Monitoring: Local logs
```

### Staging
```yaml
Environment: staging
URL: https://staging.translator.noreika.lt
Database: PostgreSQL (Managed)
Cache: Redis (Managed)
Monitoring: DataDog
```

### Production
```yaml
Environment: production
URL: https://translator.noreika.lt
Database: PostgreSQL (HA Cluster)
Cache: Redis (Cluster)
Monitoring: DataDog + PagerDuty
```

## Deployment Process

### 1. Database Migration
```bash
# Backup existing database
pg_dump -h prod-db -U translator -d translator > backup-$(date +%Y%m%d).sql

# Run migrations
npm run db:migrate:prod

# Verify migrations
npm run db:verify:prod
```

### 2. API Deployment
```bash
# Build Docker image
docker build -t translator-api:v1.0.0 ./api

# Push to registry
docker push registry.noreika.lt/translator-api:v1.0.0

# Deploy using Kubernetes
kubectl apply -f k8s/production/

# Verify deployment
kubectl rollout status deployment/translator-api -n production
```

### 3. Plugin Deployment
```bash
# Build plugin
cd plugin && npm run build

# Package for Rocket.Chat
rc-apps package

# Deploy to Rocket.Chat instance
rc-apps deploy \
  --url https://rocketchat.example.com \
  --username admin \
  --password $ROCKETCHAT_PASSWORD
```

### 4. Post-Deployment Verification
```bash
# Health checks
curl https://translator.noreika.lt/health

# Smoke tests
npm run test:smoke:prod

# Monitor metrics
npm run monitor:prod
```

## Rollback Procedure

### Automatic Rollback Triggers
- Health check failures (3 consecutive)
- Error rate > 5%
- Response time > 2000ms (p95)
- Memory usage > 80%

### Manual Rollback Steps
```bash
# 1. Switch traffic to previous version
kubectl set image deployment/translator-api \
  api=translator-api:previous-version \
  -n production

# 2. Verify rollback
kubectl rollout status deployment/translator-api -n production

# 3. Restore database if needed
psql -h prod-db -U translator -d translator < backup-latest.sql

# 4. Clear cache
redis-cli -h prod-redis FLUSHALL

# 5. Notify team
./scripts/notify-rollback.sh
```

## Monitoring & Alerts

### Key Metrics
```yaml
Application Metrics:
  - Request rate
  - Response time (p50, p95, p99)
  - Error rate
  - Translation success rate
  - Cache hit rate

Infrastructure Metrics:
  - CPU usage
  - Memory usage
  - Disk I/O
  - Network throughput
  - Database connections

Business Metrics:
  - Active users
  - Translations per minute
  - Provider usage distribution
  - Cost per translation
  - Revenue tracking
```

### Alert Configuration
```yaml
Critical Alerts (PagerDuty):
  - Service down
  - Error rate > 10%
  - Database unreachable
  - All providers failing

Warning Alerts (Slack):
  - Error rate > 5%
  - Response time > 1000ms
  - Memory usage > 70%
  - Provider degraded

Info Alerts (Email):
  - Daily usage report
  - Weekly cost analysis
  - Monthly performance summary
```

## Scaling Strategy

### Horizontal Scaling
```yaml
API Servers:
  Min: 2 instances
  Max: 10 instances
  Target CPU: 70%
  Scale up: +2 instances when CPU > 70% for 2 min
  Scale down: -1 instance when CPU < 30% for 10 min

Database:
  Primary: 1 instance (writes)
  Replicas: 2-5 instances (reads)
  Connection pool: 100 per instance

Redis:
  Cluster mode: 3 masters, 3 replicas
  Memory: 4GB per node
  Eviction policy: allkeys-lru
```

### Vertical Scaling Triggers
- Consistent memory pressure
- Database query times increasing
- Cache eviction rate high

## Disaster Recovery

### Backup Strategy
```yaml
Database:
  - Full backup: Daily at 2 AM UTC
  - Incremental: Every 6 hours
  - Retention: 30 days
  - Offsite: AWS S3

Redis:
  - Snapshot: Every hour
  - AOF: Enabled
  - Retention: 7 days

Code:
  - Git repository: GitHub
  - Docker images: Registry with 10 version history
  - Configuration: Encrypted in vault
```

### Recovery Time Objectives
- RTO (Recovery Time Objective): 1 hour
- RPO (Recovery Point Objective): 6 hours

### Incident Response
1. **Detection** (0-5 min)
   - Automated monitoring alerts
   - User reports

2. **Triage** (5-15 min)
   - Assess severity
   - Notify stakeholders

3. **Mitigation** (15-30 min)
   - Apply immediate fixes
   - Scale resources if needed

4. **Resolution** (30-60 min)
   - Deploy permanent fix
   - Verify stability

5. **Post-Mortem** (Within 48 hours)
   - Root cause analysis
   - Prevention measures

## Security Considerations

### API Security
- Rate limiting: 100 req/min per user
- API key rotation: Monthly
- JWT expiration: 24 hours
- Request signing: HMAC-SHA256

### Data Protection
- Encryption at rest: AES-256
- Encryption in transit: TLS 1.3
- PII handling: GDPR compliant
- Audit logging: All API calls

### Compliance
- GDPR: User data deletion API
- CCPA: Data export functionality
- SOC 2: Annual audit
- ISO 27001: In progress

## Performance Optimization

### Caching Strategy
```yaml
Translation Cache:
  - TTL: 1 hour for short texts
  - TTL: 24 hours for long texts
  - Max size: 10,000 entries
  - Warm-up: Popular translations

User Preferences:
  - TTL: 5 minutes
  - Refresh on update

Provider Stats:
  - TTL: 30 seconds
  - Rolling window: 5 minutes
```

### Database Optimization
```sql
-- Indexes
CREATE INDEX idx_translations_hash ON translations_cache(hash);
CREATE INDEX idx_usage_user_date ON usage_tracking(user_id, created_at);
CREATE INDEX idx_preferences_user ON users_preferences(user_id);

-- Partitioning
ALTER TABLE usage_tracking PARTITION BY RANGE (created_at);
```

### CDN Configuration
- Static assets: CloudFlare
- API responses: Not cached
- Geolocation: Enabled
- DDoS protection: Enabled

## Maintenance Windows

### Scheduled Maintenance
- Time: Sunday 2-4 AM UTC
- Frequency: Monthly
- Notifications: 1 week advance

### Zero-Downtime Deployments
1. Deploy new version to staging
2. Run parallel with production
3. Gradually shift traffic (canary)
4. Monitor metrics
5. Complete migration or rollback

## Support & Troubleshooting

### Common Issues

#### High Latency
```bash
# Check provider status
curl https://translator.noreika.lt/api/translate/providers

# Check cache hit rate
redis-cli INFO stats | grep keyspace_hits

# Check database slow queries
psql -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10"
```

#### Translation Failures
```bash
# Check provider API keys
./scripts/verify-providers.sh

# Check rate limits
curl https://translator.noreika.lt/api/stats/rate-limits

# Review error logs
kubectl logs -f deployment/translator-api --tail=100
```

#### Memory Issues
```bash
# Check memory usage
kubectl top pods -n production

# Analyze heap dump
kubectl exec -it translator-api-xxx -- kill -USR1 1

# Clear cache if needed
redis-cli MEMORY DOCTOR
```

---

*Last Updated: 2024-09-12*
*Next Review: 2024-10-12*