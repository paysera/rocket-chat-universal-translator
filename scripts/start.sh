#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Rocket Chat Universal Translator${NC}"
echo "=================================================="

# Function to wait for service
wait_for_service() {
    local url=$1
    local service=$2
    local max_attempts=30
    local attempt=1

    echo -n "Waiting for $service..."

    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null 2>&1; then
            echo -e " ${GREEN}✅ Ready${NC}"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo -e " ${RED}❌ Timeout${NC}"
    return 1
}

# 1. Run startup checks
echo "Running startup checks..."
./scripts/startup-check.sh
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️ Some checks failed. Please fix issues before continuing.${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 2. Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm run install:all
fi

# 3. Build if needed
if [ ! -d "shared/dist" ] || [ ! -d "api/dist" ]; then
    echo -e "${YELLOW}🔨 Building project...${NC}"
    npm run build
fi

# 4. Start services based on mode
MODE=${1:-docker}

if [ "$MODE" = "docker" ]; then
    echo -e "${BLUE}🐳 Starting with Docker Compose...${NC}"

    # Use the fixed docker-compose file if it exists
    if [ -f "docker-compose.fixed.yml" ]; then
        COMPOSE_FILE="docker-compose.fixed.yml"
    else
        COMPOSE_FILE="docker-compose.yml"
    fi

    # Start services
    docker-compose -f $COMPOSE_FILE up -d

    # Wait for services
    echo ""
    echo "Waiting for services to be ready..."
    wait_for_service "http://localhost:5433" "PostgreSQL"
    wait_for_service "http://localhost:6380" "Redis"
    wait_for_service "http://localhost:3030/api/info" "Rocket.Chat"
    wait_for_service "http://localhost:3001/healthz" "API Server"

    echo ""
    echo -e "${GREEN}✅ All services started successfully!${NC}"
    echo ""
    echo "Access points:"
    echo "  - Rocket.Chat: http://localhost:3030"
    echo "  - API Server: http://localhost:3001"
    echo "  - API Health: http://localhost:3001/healthz"
    echo "  - API Ready: http://localhost:3001/readyz"
    echo ""
    echo "Default Rocket.Chat credentials:"
    echo "  - Username: admin"
    echo "  - Password: admin123"
    echo ""
    echo "To view logs: docker-compose -f $COMPOSE_FILE logs -f"
    echo "To stop: docker-compose -f $COMPOSE_FILE down"

elif [ "$MODE" = "local" ]; then
    echo -e "${BLUE}💻 Starting locally...${NC}"

    # Check if Docker services are running for DB/Redis
    echo "Checking for database services..."

    # Start only infrastructure services
    docker-compose up -d postgres redis mongo rocketchat

    # Wait for infrastructure
    wait_for_service "http://localhost:5433" "PostgreSQL"
    wait_for_service "http://localhost:6380" "Redis"
    wait_for_service "http://localhost:3030/api/info" "Rocket.Chat"

    # Start API locally
    echo -e "${BLUE}Starting API server locally...${NC}"
    cd api && npm run dev &
    API_PID=$!

    cd ..

    # Wait for API
    wait_for_service "http://localhost:3001/healthz" "API Server"

    echo ""
    echo -e "${GREEN}✅ All services started successfully!${NC}"
    echo ""
    echo "Access points:"
    echo "  - Rocket.Chat: http://localhost:3030"
    echo "  - API Server: http://localhost:3001"
    echo ""
    echo "API Server PID: $API_PID"
    echo "To stop API: kill $API_PID"
    echo "To stop Docker services: docker-compose down"

else
    echo -e "${RED}❌ Unknown mode: $MODE${NC}"
    echo "Usage: $0 [docker|local]"
    exit 1
fi