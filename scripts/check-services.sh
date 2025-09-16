#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Checking services status..."
echo "================================"

# Function to check service
check_service() {
    local name=$1
    local host=$2
    local port=$3
    local type=$4

    echo -n "Checking $name... "

    if [ "$type" = "http" ]; then
        if curl -f -s "http://$host:$port" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Running${NC}"
            return 0
        fi
    else
        if nc -z $host $port 2>/dev/null; then
            echo -e "${GREEN}✅ Running${NC}"
            return 0
        fi
    fi

    echo -e "${RED}❌ Not running${NC}"
    return 1
}

# Check all services
ALL_GOOD=true

check_service "PostgreSQL" "localhost" "5434" "tcp" || ALL_GOOD=false
check_service "Redis" "localhost" "6381" "tcp" || ALL_GOOD=false
check_service "MongoDB" "localhost" "27017" "tcp" || ALL_GOOD=false
check_service "Rocket.Chat" "192.168.110.199" "3013" "http" || ALL_GOOD=false
check_service "API Server" "192.168.110.199" "3012" "http" || ALL_GOOD=false

echo "================================"

if [ "$ALL_GOOD" = true ]; then
    echo -e "${GREEN}✅ All services are running!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some services are not running${NC}"
    echo ""
    echo "To start services, run:"
    echo "  docker-compose -f docker-compose.dev.yml up -d"
    exit 1
fi