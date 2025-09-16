#!/bin/bash

echo "🔍 Universal Translator System Diagnostics"
echo "=========================================="

# System information
echo "📊 System Information:"
echo "Date: $(date)"
echo "OS: $(uname -a)"
echo "Docker: $(docker --version 2>/dev/null || echo 'Docker not available')"
echo "Docker Compose: $(docker-compose --version 2>/dev/null || echo 'Docker Compose not available')"
echo ""

# Check if docker-compose file exists
COMPOSE_FILE="docker-compose.dev.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
    echo "❌ Docker compose file not found: $COMPOSE_FILE"
    exit 1
fi

# Service status
echo "🏥 Service Status:"
docker-compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "❌ Failed to get service status"
echo ""

# Port checks
echo "🔌 Port Status:"
for port in 3012 3013 5434 6381 27017; do
  if command -v lsof >/dev/null 2>&1 && lsof -i :$port > /dev/null 2>&1; then
    echo "✅ Port $port: In use"
  elif command -v netstat >/dev/null 2>&1 && netstat -an | grep -q ":$port "; then
    echo "✅ Port $port: In use"
  else
    echo "❌ Port $port: Available/Not in use"
  fi
done
echo ""

# Health checks
echo "🏥 Health Checks:"
if command -v curl >/dev/null 2>&1; then
  if curl -f -s http://192.168.110.199:3012/healthz > /dev/null 2>&1; then
    echo "✅ API Health: OK"
    echo "📊 API Readiness:"
    curl -s http://192.168.110.199:3012/readyz 2>/dev/null | {
      if command -v jq >/dev/null 2>&1; then
        jq '.checks // "No readiness data"'
      else
        cat
      fi
    }
  else
    echo "❌ API Health: FAILED"
  fi

  if curl -f -s http://192.168.110.199:3013/api/info > /dev/null 2>&1; then
    echo "✅ Rocket.Chat: OK"
  else
    echo "❌ Rocket.Chat: FAILED"
  fi
else
  echo "⚠️  curl not available, skipping HTTP health checks"
fi
echo ""

# Database connectivity
echo "🗄️ Database Connectivity:"
if docker ps --format '{{.Names}}' | grep -q "translator-postgres-dev"; then
  if docker exec translator-postgres-dev pg_isready -U translator >/dev/null 2>&1; then
    echo "✅ PostgreSQL: Connected"
  else
    echo "❌ PostgreSQL: Connection failed"
  fi
else
  echo "❌ PostgreSQL: Container not running"
fi

if docker ps --format '{{.Names}}' | grep -q "translator-redis-dev"; then
  if docker exec translator-redis-dev redis-cli ping >/dev/null 2>&1; then
    echo "✅ Redis: Connected"
  else
    echo "❌ Redis: Connection failed"
  fi
else
  echo "❌ Redis: Container not running"
fi

if docker ps --format '{{.Names}}' | grep -q "translator-mongodb-dev"; then
  if docker exec translator-mongodb-dev mongosh --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo "✅ MongoDB: Connected"
  else
    echo "❌ MongoDB: Connection failed"
  fi
else
  echo "❌ MongoDB: Container not running"
fi
echo ""

# Resource usage
echo "📈 Resource Usage:"
echo "Memory:"
if command -v free >/dev/null 2>&1; then
  free -h
elif command -v vm_stat >/dev/null 2>&1; then
  # macOS
  vm_stat | head -5
else
  echo "Memory info not available"
fi
echo ""

echo "Disk:"
df -h / 2>/dev/null | tail -1 || echo "Disk info not available"
echo ""

echo "Docker stats:"
if command -v docker >/dev/null 2>&1; then
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null || echo "Docker stats not available"
else
  echo "Docker not available"
fi
echo ""

# Recent errors
echo "🚨 Recent Errors (last 10 minutes):"
if docker ps --format '{{.Names}}' | grep -q "translator-api-dev"; then
  docker logs translator-api-dev --since 10m 2>&1 | grep -i error | tail -5 || echo "No recent errors found"
else
  echo "API container not running"
fi
echo ""

# Environment check
echo "🔧 Environment Configuration:"
if [ -f ".env" ]; then
  echo "✅ .env file exists"
  # Check for API keys without revealing them
  if grep -q "OPENAI_API_KEY=" .env && [ -n "$(grep "OPENAI_API_KEY=" .env | cut -d'=' -f2)" ]; then
    echo "✅ OpenAI API key configured"
  else
    echo "⚠️  OpenAI API key not configured"
  fi

  if grep -q "ANTHROPIC_API_KEY=" .env && [ -n "$(grep "ANTHROPIC_API_KEY=" .env | cut -d'=' -f2)" ]; then
    echo "✅ Anthropic API key configured"
  else
    echo "⚠️  Anthropic API key not configured"
  fi
else
  echo "❌ .env file not found"
fi
echo ""

echo "✅ Diagnostics complete!"
echo ""
echo "📋 Next Steps:"
echo "For more detailed analysis, check individual service logs:"
echo "  docker logs translator-api-dev --tail 50"
echo "  docker logs translator-rocketchat-dev --tail 50"
echo "  docker logs translator-postgres-dev --tail 50"
echo "  docker logs translator-redis-dev --tail 50"
echo "  docker logs translator-mongodb-dev --tail 50"
echo ""
echo "🔧 Quick fixes:"
echo "  Restart all services: docker-compose -f $COMPOSE_FILE restart"
echo "  Clean restart:       docker-compose -f $COMPOSE_FILE down && docker-compose -f $COMPOSE_FILE up -d"
echo "  Check documentation: README.md, DEVELOPER_GUIDE.md, TROUBLESHOOTING.md"