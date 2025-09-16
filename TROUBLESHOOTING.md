# Troubleshooting Guide

## 🔍 Quick Diagnostics

Run this first to get an overview of system status:
```bash
./scripts/diagnose.sh
```

If the script doesn't exist, you can run manual checks:
```bash
# Check services
docker-compose -f docker-compose.dev.yml ps

# Check API health
curl -s http://192.168.110.199:3012/healthz | jq .

# Check readiness
curl -s http://192.168.110.199:3012/readyz | jq .
```

## Common Issues and Solutions

### 🔴 Services Won't Start

#### Symptom
```
Error: Cannot start service api: driver failed programming external connectivity
```

#### Diagnosis
```bash
# Check port conflicts
lsof -i :3012
lsof -i :3013
lsof -i :5434
lsof -i :6381
lsof -i :27017

# Check if ports are in use
netstat -an | grep -E "3012|3013|5434|6381|27017"
```

#### Solution
```bash
# Option 1: Stop conflicting services
docker stop $(docker ps -aq)

# Option 2: Kill processes using ports
sudo lsof -ti:3012 | xargs kill -9
sudo lsof -ti:3013 | xargs kill -9

# Option 3: Clean restart
docker-compose -f docker-compose.dev.yml down -v
docker system prune -f
docker-compose -f docker-compose.dev.yml up -d
```

### 🔴 MongoDB Replica Set Error

#### Symptom
```
MongoServerError: not master and slaveOk=false
```

#### Diagnosis
```bash
# Check MongoDB container status
docker logs translator-mongodb-dev --tail 50

# Connect to MongoDB
docker exec -it translator-mongodb-dev mongosh
```

#### Solution
```bash
# Initialize replica set manually
docker exec -it translator-mongodb-dev mongosh
> rs.initiate()
> rs.status()

# If still failing, restart MongoDB
docker-compose -f docker-compose.dev.yml restart mongodb
```

### 🔴 PostgreSQL Connection Failed

#### Symptom
```
Error: connection to server failed: Connection refused
```

#### Diagnosis
```bash
# Check PostgreSQL container
docker logs translator-postgres-dev --tail 50

# Test connection
docker exec -it translator-postgres-dev psql -U translator -d translator -c "SELECT 1;"
```

#### Solution
```bash
# Restart PostgreSQL
docker-compose -f docker-compose.dev.yml restart postgres

# If data corruption, reset database
docker-compose -f docker-compose.dev.yml down -v
docker volume rm translator_postgres_data
docker-compose -f docker-compose.dev.yml up -d postgres
```

### 🔴 Redis Connection Failed

#### Symptom
```
Error: Redis connection failed: ECONNREFUSED
```

#### Diagnosis
```bash
# Check Redis container
docker logs translator-redis-dev --tail 50

# Test Redis connection
docker exec -it translator-redis-dev redis-cli ping
```

#### Solution
```bash
# Restart Redis
docker-compose -f docker-compose.dev.yml restart redis

# Clear Redis data if needed
docker exec -it translator-redis-dev redis-cli FLUSHALL
```

### 🔴 Translation Not Working

#### Symptom
Messages not being translated or API returning errors

#### Diagnosis Checklist

1. **✓ API keys configured?**
   ```bash
   grep "API_KEY" .env
   echo "OpenAI: ${OPENAI_API_KEY:0:10}..."
   echo "Anthropic: ${ANTHROPIC_API_KEY:0:10}..."
   ```

2. **✓ API service running?**
   ```bash
   curl http://192.168.110.199:3012/healthz
   curl http://192.168.110.199:3012/readyz
   ```

3. **✓ Provider configuration?**
   ```bash
   # Check if providers are enabled
   cat config/providers.json 2>/dev/null || echo "Config file not found"
   ```

4. **✓ Check API logs**
   ```bash
   docker logs translator-api-dev --tail 100 | grep -i error
   ```

5. **✓ Test translation directly**
   ```bash
   curl -X POST http://192.168.110.199:3012/api/translate \
     -H "Content-Type: application/json" \
     -d '{"text":"Hello","targetLang":"lt","provider":"openai"}'
   ```

#### Solutions

**API Key Issues:**
```bash
# Verify OpenAI key
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/models | jq '.data[0].id'

# Verify Anthropic key
curl -H "x-api-key: $ANTHROPIC_API_KEY" \
     https://api.anthropic.com/v1/models | jq '.data[0].id'

# Verify DeepL key
curl -H "Authorization: DeepL-Auth-Key $DEEPL_API_KEY" \
     https://api-free.deepl.com/v2/usage | jq '.character_count'
```

**Provider Configuration:**
```bash
# Reset provider configuration
cp config/providers.json.example config/providers.json
```

### 🟡 High Memory Usage

#### Symptom
Container using excessive memory (>2GB)

#### Diagnosis
```bash
# Check memory usage
docker stats --no-stream

# Check specific container
docker exec translator-api-dev ps aux --sort=-%mem | head

# Check for memory leaks
docker exec translator-api-dev node -e "console.log(process.memoryUsage())"
```

#### Solution
```bash
# Restart high-memory service
docker-compose -f docker-compose.dev.yml restart translator-api

# Adjust memory limits in docker-compose.dev.yml
# Add under service definition:
deploy:
  resources:
    limits:
      memory: 2G
    reservations:
      memory: 512M

# If persistent, check for memory leaks in code
npm run test:memory-leak
```

### 🟡 Slow Translation Response

#### Symptom
Translation takes >5 seconds or timeouts occur

#### Diagnosis
```bash
# Check response time
curl -w "@curl-format.txt" -o /dev/null -s \
  -X POST http://192.168.110.199:3012/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello","targetLang":"lt"}'

# Check Redis cache hit rate
docker exec translator-redis-dev redis-cli INFO stats | grep keyspace

# Check database query performance
docker exec translator-postgres-dev psql -U translator -c "
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;"
```

#### Solution
```bash
# Enable query statistics (if not enabled)
docker exec translator-postgres-dev psql -U translator -c "
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

# Add missing indexes
docker exec translator-postgres-dev psql -U translator -c "
CREATE INDEX IF NOT EXISTS idx_translations_created ON translations(created_at);
CREATE INDEX IF NOT EXISTS idx_translations_langs ON translations(source_lang, target_lang);
CREATE INDEX IF NOT EXISTS idx_translations_user ON translations(user_id);"

# Increase Redis memory
docker exec translator-redis-dev redis-cli CONFIG SET maxmemory 512mb
docker exec translator-redis-dev redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Clear old cache entries
docker exec translator-redis-dev redis-cli EVAL "
for i, name in ipairs(redis.call('KEYS', 'translation:*')) do
  local ttl = redis.call('TTL', name)
  if ttl == -1 then
    redis.call('EXPIRE', name, 3600)
  end
end
return 'OK'
" 0
```

### 🟡 Rate Limiting Issues

#### Symptom
```json
{"error": "Rate limit exceeded", "retryAfter": 60}
```

#### Diagnosis
```bash
# Check current rate limits
docker exec translator-redis-dev redis-cli KEYS "rate_limit:*"

# Check specific rate limit
docker exec translator-redis-dev redis-cli GET "rate_limit:ip:192.168.110.199"
```

#### Solution
```bash
# Clear rate limit for specific IP
docker exec translator-redis-dev redis-cli DEL "rate_limit:ip:192.168.110.199"

# Adjust rate limits in configuration
# Edit api/src/middleware/rateLimiter.ts:
windowMs: 60000,     # 1 minute
max: 200            # Increase from 100 to 200

# Clear all rate limits (use with caution)
docker exec translator-redis-dev redis-cli EVAL "
return redis.call('DEL', unpack(redis.call('KEYS', 'rate_limit:*')))
" 0
```

### 🟡 Plugin Not Loading in Rocket.Chat

#### Symptom
Plugin not visible in Rocket.Chat administration

#### Diagnosis
```bash
# Check plugin build
cd plugin && npm run build

# Check plugin package
ls -la plugin/dist/

# Check Rocket.Chat logs
docker logs translator-rocketchat-dev | grep -i plugin

# Check plugin upload
curl -X GET http://192.168.110.199:3013/api/v1/apps \
  -H "X-Auth-Token: YOUR_TOKEN" \
  -H "X-User-Id: YOUR_USER_ID"
```

#### Solution
```bash
# Rebuild plugin
cd plugin
npm run build

# Restart Rocket.Chat
docker-compose -f docker-compose.dev.yml restart rocketchat

# Manually install plugin via UI
# 1. Go to http://192.168.110.199:3013/admin/apps
# 2. Upload plugin/dist/app.zip
```

## 📊 Performance Issues

### Database Optimization

```sql
-- Find slow queries
SELECT
  query,
  calls,
  mean_exec_time,
  total_exec_time,
  stddev_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Create recommended indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_translations_created_at
ON translations(created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_translations_source_target
ON translations(source_lang, target_lang);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_translations_text_hash
ON translations(text_hash);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_preferences_user
ON user_preferences(user_id);

-- Update table statistics
ANALYZE translations;
ANALYZE user_preferences;
```

### Redis Performance Optimization

```bash
# Check Redis memory usage
docker exec translator-redis-dev redis-cli INFO memory

# Optimize Redis configuration
docker exec translator-redis-dev redis-cli CONFIG SET maxmemory 1gb
docker exec translator-redis-dev redis-cli CONFIG SET maxmemory-policy allkeys-lru
docker exec translator-redis-dev redis-cli CONFIG SET save ""  # Disable persistence for cache

# Monitor Redis performance
docker exec translator-redis-dev redis-cli MONITOR | head -100

# Clean old cache entries
docker exec translator-redis-dev redis-cli EVAL "
local keys = redis.call('KEYS', 'translation:*')
local count = 0
for i=1,#keys do
  local ttl = redis.call('TTL', keys[i])
  if ttl < 600 then  -- Remove entries expiring in less than 10 minutes
    redis.call('DEL', keys[i])
    count = count + 1
  end
end
return count
" 0
```

### API Performance Monitoring

```bash
# Enable performance monitoring
export NODE_ENV=development
export DEBUG=translator:performance:*

# Monitor request timing
tail -f api/logs/performance.log | grep "slow_request"

# Check for memory leaks
docker exec translator-api-dev node --expose-gc -e "
setInterval(() => {
  global.gc();
  console.log(process.memoryUsage());
}, 5000);
"

# Monitor API endpoints
curl -w "@curl-format.txt" -o /dev/null -s http://192.168.110.199:3012/api/translate
```

### Create curl timing format file

```bash
cat > curl-format.txt << 'EOF'
\n
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
\n
EOF
```

## 🔐 Security Issues

### API Key Validation

```bash
# Check API key format
echo $OPENAI_API_KEY | grep -E "^sk-[a-zA-Z0-9]{48}$"
echo $ANTHROPIC_API_KEY | grep -E "^sk-ant-api03-[a-zA-Z0-9_-]{95}$"

# Test API key validity
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"test"}],"max_tokens":1}' \
     https://api.openai.com/v1/chat/completions

# Check API key permissions
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
     https://api.openai.com/v1/models | jq '.data[] | select(.id=="gpt-4")'
```

### CORS Configuration

```bash
# Check CORS headers
curl -H "Origin: http://192.168.110.199:3013" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: X-Requested-With" \
     -X OPTIONS \
     http://192.168.110.199:3012/api/translate -v

# Fix CORS in api/src/server.ts
app.use(cors({
  origin: [
    'http://192.168.110.199:3013',
    'http://localhost:3013',
    'https://translate-chat.paysera.tech',
    'https://translate-chat-dev.paysera.tech'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With']
}));
```

### SSL/TLS Issues (Production)

```bash
# Check SSL certificate
curl -vI https://translate-api.paysera.tech 2>&1 | grep -E "SSL|TLS|certificate"

# Test HTTPS connectivity
openssl s_client -connect translate-api.paysera.tech:443 -servername translate-api.paysera.tech

# Check certificate expiration
echo | openssl s_client -connect translate-api.paysera.tech:443 2>/dev/null | openssl x509 -noout -dates
```

## 📝 Logging and Debugging

### Enable Comprehensive Logging

```bash
# Set environment variables
export DEBUG=translator:*
export LOG_LEVEL=debug
export LOG_TO_CONSOLE=true

# Restart services with logging
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d
```

### Log Analysis

```bash
# API logs
docker logs translator-api-dev -f --tail 100

# Filter for errors
docker logs translator-api-dev --since 1h | grep -i error

# Filter for specific provider
docker logs translator-api-dev --since 1h | grep -i openai

# Count errors by type
docker logs translator-api-dev --since 1h | grep ERROR | cut -d' ' -f5- | sort | uniq -c | sort -nr

# Export logs for analysis
docker logs translator-api-dev --since 24h > api-logs-$(date +%Y%m%d).txt
```

### Structured Log Queries

```bash
# Using jq for JSON logs
docker logs translator-api-dev --since 1h | grep '^{' | jq 'select(.level=="ERROR")'

# Find slow requests
docker logs translator-api-dev --since 1h | grep '^{' | jq 'select(.duration > 5000)'

# Find provider errors
docker logs translator-api-dev --since 1h | grep '^{' | jq 'select(.provider and .error)'
```

## 🚨 Emergency Procedures

### Complete System Reset

```bash
#!/bin/bash
# emergency-reset.sh

echo "⚠️  WARNING: This will delete all data!"
echo "This includes:"
echo "- All translation history"
echo "- User preferences"
echo "- Cache data"
echo "- Log files"
echo ""
read -p "Continue? (type 'RESET' to confirm): " -r

if [[ $REPLY == "RESET" ]]; then
  echo "🔄 Stopping all services..."
  docker-compose -f docker-compose.dev.yml down -v

  echo "🧹 Cleaning Docker resources..."
  docker system prune -a -f
  docker volume prune -f

  echo "🗑️  Removing data directories..."
  rm -rf data/ logs/ api/logs/

  echo "🔧 Rebuilding services..."
  docker-compose -f docker-compose.dev.yml build --no-cache

  echo "🚀 Starting fresh services..."
  docker-compose -f docker-compose.dev.yml up -d

  echo "⏳ Waiting for services to be ready..."
  sleep 30

  echo "🏥 Health check..."
  curl -f http://192.168.110.199:3012/healthz || echo "❌ API health check failed"
  curl -f http://192.168.110.199:3013/api/info || echo "❌ Rocket.Chat health check failed"

  echo "✅ System reset complete"
else
  echo "❌ Reset cancelled"
fi
```

### Rollback Deployment

```bash
# List available images
docker images | grep translator

# Rollback to previous version
docker-compose -f docker-compose.dev.yml down
docker tag translator-api:latest translator-api:backup
docker pull translator-api:previous  # Or specific version
docker-compose -f docker-compose.dev.yml up -d

# Verify rollback
curl -f http://192.168.110.199:3012/healthz
```

### Data Recovery

```bash
# Create backup before recovery
docker exec translator-postgres-dev pg_dump -U translator translator > backup_before_recovery.sql

# Restore from backup
docker exec -i translator-postgres-dev psql -U translator -d translator < backup_file.sql

# Verify data integrity
docker exec translator-postgres-dev psql -U translator -c "
SELECT COUNT(*) as translation_count FROM translations;
SELECT COUNT(*) as user_pref_count FROM user_preferences;
SELECT MAX(created_at) as latest_translation FROM translations;
"
```

### Service Health Recovery

```bash
#!/bin/bash
# health-recovery.sh

services=("postgres" "redis" "mongodb" "translator-api" "rocketchat")

for service in "${services[@]}"; do
  echo "🔍 Checking $service..."

  if ! docker-compose -f docker-compose.dev.yml ps $service | grep -q "Up"; then
    echo "⚠️  $service is down, restarting..."
    docker-compose -f docker-compose.dev.yml restart $service

    # Wait for service to be ready
    sleep 10

    # Service-specific health checks
    case $service in
      "postgres")
        docker exec translator-postgres-dev pg_isready -U translator || echo "❌ PostgreSQL still not ready"
        ;;
      "redis")
        docker exec translator-redis-dev redis-cli ping || echo "❌ Redis still not ready"
        ;;
      "translator-api")
        curl -f http://192.168.110.199:3012/healthz || echo "❌ API still not ready"
        ;;
      "rocketchat")
        curl -f http://192.168.110.199:3013/api/info || echo "❌ Rocket.Chat still not ready"
        ;;
    esac
  else
    echo "✅ $service is healthy"
  fi
done
```

## 📞 Escalation Process

### When to Escalate

**Level 1** (Self-service):
- Check this troubleshooting guide
- Review logs and error messages
- Try basic restart procedures

**Level 2** (Team Support):
- Issue persists after following guide
- Multiple services affected
- Performance degradation
- Contact: #translator-support Slack

**Level 3** (Senior/Lead Developer):
- Security incidents
- Data corruption
- Service completely down >30 minutes
- Contact: @senior-dev-team Slack

**Level 4** (Emergency):
- Production outage
- Data loss
- Security breach
- Contact: oncall-engineer@paysera.com

### Information to Provide

When escalating, include:

1. **Problem Description**
   - What happened?
   - When did it start?
   - What were you trying to do?

2. **Environment Information**
   ```bash
   # System info
   uname -a
   docker version
   docker-compose version

   # Service status
   docker-compose -f docker-compose.dev.yml ps

   # Recent logs
   docker logs translator-api-dev --tail 50
   ```

3. **Steps Already Taken**
   - What troubleshooting steps have you tried?
   - What was the result of each step?

4. **Impact Assessment**
   - How many users affected?
   - Business impact level
   - Urgency level

## 🔧 Diagnostic Scripts

### System Diagnostic Script

```bash
#!/bin/bash
# diagnose.sh

echo "🔍 Universal Translator System Diagnostics"
echo "=========================================="

# System information
echo "📊 System Information:"
echo "Date: $(date)"
echo "OS: $(uname -a)"
echo "Docker: $(docker --version)"
echo "Docker Compose: $(docker-compose --version)"
echo ""

# Service status
echo "🏥 Service Status:"
docker-compose -f docker-compose.dev.yml ps
echo ""

# Port checks
echo "🔌 Port Status:"
for port in 3012 3013 5434 6381 27017; do
  if lsof -i :$port > /dev/null 2>&1; then
    echo "✅ Port $port: In use"
  else
    echo "❌ Port $port: Available"
  fi
done
echo ""

# Health checks
echo "🏥 Health Checks:"
if curl -f -s http://192.168.110.199:3012/healthz > /dev/null; then
  echo "✅ API Health: OK"
  curl -s http://192.168.110.199:3012/readyz | jq '.checks' 2>/dev/null || echo "📊 Readiness check failed"
else
  echo "❌ API Health: FAILED"
fi

if curl -f -s http://192.168.110.199:3013/api/info > /dev/null; then
  echo "✅ Rocket.Chat: OK"
else
  echo "❌ Rocket.Chat: FAILED"
fi
echo ""

# Resource usage
echo "📈 Resource Usage:"
echo "Memory:"
free -h
echo ""
echo "Disk:"
df -h / | tail -1
echo ""
echo "Docker stats:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
echo ""

# Recent errors
echo "🚨 Recent Errors (last 10 minutes):"
docker logs translator-api-dev --since 10m 2>&1 | grep -i error | tail -5
echo ""

echo "✅ Diagnostics complete!"
echo "For more detailed analysis, check individual service logs:"
echo "  docker logs translator-api-dev"
echo "  docker logs translator-rocketchat-dev"
echo "  docker logs translator-postgres-dev"
```

### Make the diagnostic script executable

```bash
# Create the script
cat > scripts/diagnose.sh << 'EOF'
[Script content from above]
EOF

# Make executable
chmod +x scripts/diagnose.sh

# Run diagnostics
./scripts/diagnose.sh
```

This comprehensive troubleshooting guide should help developers and operators quickly identify and resolve common issues with the Universal Translator system.