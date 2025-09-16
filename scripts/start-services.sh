#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🚀 Starting Universal Translator Services${NC}"
echo "=========================================="

# Change to project root
cd /opt/dev/rocket-chat-universal-translator

# Check if we have necessary tools
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    exit 1
fi

# Step 1: Stop any existing services
echo -e "${YELLOW}Stopping existing services...${NC}"
docker-compose -f docker-compose.dev.yml down --remove-orphans

# Step 2: Clean up volumes if requested
if [ "$1" = "--clean" ]; then
    echo -e "${YELLOW}Cleaning volumes...${NC}"
    docker volume rm rocket-chat-universal-translator_mongodb_data 2>/dev/null || true
    docker volume rm rocket-chat-universal-translator_postgres_data 2>/dev/null || true
    docker volume rm rocket-chat-universal-translator_redis_data 2>/dev/null || true
    docker system prune -f --volumes
fi

# Step 3: Build images
echo -e "${YELLOW}Building Docker images...${NC}"
docker-compose -f docker-compose.dev.yml build --no-cache

# Step 4: Start infrastructure services first
echo -e "${YELLOW}Starting infrastructure services...${NC}"
docker-compose -f docker-compose.dev.yml up -d mongodb postgres redis

# Wait for services to be ready
echo -e "${YELLOW}Waiting for infrastructure...${NC}"
for i in {1..60}; do
    if docker exec translator-postgres-dev pg_isready -U translator -d translator >/dev/null 2>&1 && \
       docker exec translator-redis-dev redis-cli ping >/dev/null 2>&1 && \
       docker exec translator-mongodb-dev mongosh --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Infrastructure services ready${NC}"
        break
    fi
    echo "Waiting for infrastructure services... ($i/60)"
    sleep 2
done

# Step 5: Initialize MongoDB replica set
echo -e "${YELLOW}Initializing MongoDB replica set...${NC}"
./scripts/init-mongodb-replica.sh

# Step 6: Run database migrations if they exist
echo -e "${YELLOW}Checking database migrations...${NC}"
if [ -d "./api/migrations" ] && [ "$(ls -A ./api/migrations)" ]; then
    echo "Found migrations, they will be applied automatically when API starts"
else
    echo "No migrations found"
fi

# Step 7: Start application services
echo -e "${YELLOW}Starting application services...${NC}"
docker-compose -f docker-compose.dev.yml up -d rocketchat translator-api

# Step 8: Wait for services to be ready
echo -e "${YELLOW}Waiting for services to start...${NC}"
echo "This may take a few minutes for first startup..."

# Wait for API to be ready
for i in {1..120}; do
    if curl -f -s "http://192.168.110.199:3012/healthz" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API service ready${NC}"
        break
    fi
    echo "Waiting for API service... ($i/120)"
    sleep 3
done

# Wait for Rocket.Chat to be ready
for i in {1..120}; do
    if curl -f -s "http://192.168.110.199:3013/api/info" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Rocket.Chat service ready${NC}"
        break
    fi
    echo "Waiting for Rocket.Chat service... ($i/120)"
    sleep 3
done

# Step 9: Check all services
echo ""
./scripts/check-services.sh

# Step 10: Show access URLs and status
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 All services started successfully!${NC}"
    echo ""
    echo "Access URLs:"
    echo "  Rocket.Chat: http://192.168.110.199:3013"
    echo "  API Server: http://192.168.110.199:3012"
    echo "  API Health: http://192.168.110.199:3012/healthz"
    echo "  API Ready: http://192.168.110.199:3012/readyz"
    echo ""
    echo "Credentials:"
    echo "  Rocket.Chat: admin / admin123"
    echo "  PostgreSQL: translator / translator123"
    echo ""
    echo "Service Status:"
    echo "  PostgreSQL: localhost:5434"
    echo "  Redis: localhost:6381"
    echo "  MongoDB: localhost:27017"
    echo ""
    echo "Useful commands:"
    echo "  View all logs: docker-compose -f docker-compose.dev.yml logs -f"
    echo "  View API logs: docker-compose -f docker-compose.dev.yml logs -f translator-api"
    echo "  View RC logs: docker-compose -f docker-compose.dev.yml logs -f rocketchat"
    echo "  Stop services: docker-compose -f docker-compose.dev.yml down"
    echo "  Monitor services: ./scripts/monitor-services.sh"
    echo ""
else
    echo ""
    echo -e "${RED}⚠️ Some services failed to start${NC}"
    echo ""
    echo "Troubleshooting commands:"
    echo "  View logs: docker-compose -f docker-compose.dev.yml logs"
    echo "  Check containers: docker ps -a"
    echo "  Check individual service:"
    echo "    docker logs translator-api-dev"
    echo "    docker logs translator-rocketchat-dev"
    echo "    docker logs translator-mongodb-dev"
    echo "    docker logs translator-postgres-dev"
    echo "    docker logs translator-redis-dev"
    exit 1
fi