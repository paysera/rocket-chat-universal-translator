#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to get service status
get_service_status() {
    local service=$1
    local host=$2
    local port=$3
    local type=$4

    if [ "$type" = "http" ]; then
        if curl -f -s "http://$host:$port" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Running${NC}"
        else
            echo -e "${RED}❌ Not responding${NC}"
        fi
    else
        if nc -z $host $port 2>/dev/null; then
            echo -e "${GREEN}✅ Running${NC}"
        else
            echo -e "${RED}❌ Not running${NC}"
        fi
    fi
}

# Function to display service monitor
display_monitor() {
    clear
    echo -e "${BLUE}🔍 Universal Translator Service Monitor${NC}"
    echo "========================================"
    echo -e "${YELLOW}Last updated: $(date)${NC}"
    echo ""

    # Docker Containers Status
    echo -e "${BLUE}Docker Containers:${NC}"
    echo "==================="
    if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "translator|NAME" | while IFS= read -r line; do
        if echo "$line" | grep -q "NAME"; then
            echo -e "${YELLOW}$line${NC}"
        elif echo "$line" | grep -q "(healthy)"; then
            echo -e "${GREEN}$line${NC}"
        elif echo "$line" | grep -q "Up"; then
            echo -e "${YELLOW}$line${NC}"
        else
            echo -e "${RED}$line${NC}"
        fi
    done; then
        echo ""
    else
        echo -e "${RED}No translator containers found${NC}"
        echo ""
    fi

    # Service Health Checks
    echo -e "${BLUE}Service Health:${NC}"
    echo "================"
    echo -n "PostgreSQL (5433): "
    get_service_status "PostgreSQL" "localhost" "5433" "tcp"

    echo -n "Redis (6380): "
    get_service_status "Redis" "localhost" "6380" "tcp"

    echo -n "MongoDB (27017): "
    get_service_status "MongoDB" "localhost" "27017" "tcp"

    echo -n "API Server (3012): "
    get_service_status "API" "192.168.110.199" "3012" "http"

    echo -n "Rocket.Chat (3013): "
    get_service_status "Rocket.Chat" "192.168.110.199" "3013" "http"

    echo ""

    # API Health Details
    echo -e "${BLUE}API Health Details:${NC}"
    echo "==================="
    if command_exists jq; then
        echo -n "Health Check: "
        if HEALTH=$(curl -s http://192.168.110.199:3012/healthz 2>/dev/null); then
            if echo "$HEALTH" | jq -e . >/dev/null 2>&1; then
                echo -e "${GREEN}✅ $(echo "$HEALTH" | jq -r '.status // "OK"')${NC}"
            else
                echo -e "${YELLOW}⚠️ Response not JSON${NC}"
            fi
        else
            echo -e "${RED}❌ No response${NC}"
        fi

        echo -n "Ready Check: "
        if READY=$(curl -s http://192.168.110.199:3012/readyz 2>/dev/null); then
            if echo "$READY" | jq -e . >/dev/null 2>&1; then
                echo -e "${GREEN}✅ $(echo "$READY" | jq -r '.status // "Ready"')${NC}"
            else
                echo -e "${YELLOW}⚠️ Response not JSON${NC}"
            fi
        else
            echo -e "${RED}❌ No response${NC}"
        fi
    else
        echo "jq not installed - install with: brew install jq"
    fi
    echo ""

    # Database Connectivity
    echo -e "${BLUE}Database Connectivity:${NC}"
    echo "======================"
    echo -n "PostgreSQL: "
    if docker exec translator-postgres-dev pg_isready -U translator -d translator >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Ready${NC}"
    else
        echo -e "${RED}❌ Not ready${NC}"
    fi

    echo -n "Redis: "
    if docker exec translator-redis-dev redis-cli ping >/dev/null 2>&1; then
        echo -e "${GREEN}✅ PONG${NC}"
    else
        echo -e "${RED}❌ No response${NC}"
    fi

    echo -n "MongoDB Replica Set: "
    if docker exec translator-mongodb-dev mongosh --quiet --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q "true"; then
        echo -e "${GREEN}✅ Primary${NC}"
    else
        echo -e "${RED}❌ Not primary${NC}"
    fi
    echo ""

    # Resource Usage
    echo -e "${BLUE}Resource Usage:${NC}"
    echo "==============="
    if docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" 2>/dev/null | grep -E "translator|NAME" | while IFS= read -r line; do
        if echo "$line" | grep -q "NAME"; then
            echo -e "${YELLOW}$line${NC}"
        else
            # Color code based on CPU usage
            CPU=$(echo "$line" | awk '{print $2}' | sed 's/%//')
            if (( $(echo "$CPU > 80" | bc -l 2>/dev/null || echo "0") )); then
                echo -e "${RED}$line${NC}"
            elif (( $(echo "$CPU > 50" | bc -l 2>/dev/null || echo "0") )); then
                echo -e "${YELLOW}$line${NC}"
            else
                echo -e "${GREEN}$line${NC}"
            fi
        fi
    done; then
        echo ""
    else
        echo -e "${RED}No resource data available${NC}"
        echo ""
    fi

    # Quick Actions
    echo -e "${BLUE}Quick Actions:${NC}"
    echo "=============="
    echo "  ${YELLOW}r${NC} - Restart all services"
    echo "  ${YELLOW}l${NC} - View logs"
    echo "  ${YELLOW}s${NC} - Stop all services"
    echo "  ${YELLOW}q${NC} - Quit monitor"
    echo "  ${YELLOW}c${NC} - Check service health"
    echo ""
    echo -e "${YELLOW}Press any key to refresh, or use quick actions above${NC}"
}

# Interactive mode
if [ "$1" = "--interactive" ] || [ "$1" = "-i" ]; then
    while true; do
        display_monitor

        # Read single character with timeout
        read -t 5 -n 1 key 2>/dev/null || key=""

        case $key in
            r|R)
                echo -e "\n${YELLOW}Restarting services...${NC}"
                docker-compose -f docker-compose.dev.yml restart
                sleep 3
                ;;
            l|L)
                echo -e "\n${YELLOW}Showing logs (Ctrl+C to return)...${NC}"
                sleep 2
                docker-compose -f docker-compose.dev.yml logs --tail=50 -f
                ;;
            s|S)
                echo -e "\n${YELLOW}Stopping services...${NC}"
                docker-compose -f docker-compose.dev.yml down
                sleep 2
                ;;
            c|C)
                echo -e "\n${YELLOW}Running service health check...${NC}"
                ./scripts/check-services.sh
                echo -e "\nPress any key to continue..."
                read -n 1
                ;;
            q|Q)
                echo -e "\n${GREEN}Goodbye!${NC}"
                exit 0
                ;;
        esac
    done
else
    # One-time monitoring using watch
    if command_exists watch; then
        watch -n 5 '
        echo "🔍 Service Status Monitor"
        echo "========================="
        echo ""
        echo "Docker Containers:"
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "translator|NAME" || echo "No containers found"
        echo ""
        echo "Service Health:"
        curl -s http://192.168.110.199:3012/healthz 2>/dev/null | jq . 2>/dev/null || echo "API: Not responding"
        curl -s http://192.168.110.199:3012/readyz 2>/dev/null | jq . 2>/dev/null || echo "API Ready: Not ready"
        echo ""
        echo "Database Connections:"
        docker exec translator-postgres-dev pg_isready -U translator -d translator 2>/dev/null && echo "PostgreSQL: Ready" || echo "PostgreSQL: Not ready"
        docker exec translator-redis-dev redis-cli ping 2>/dev/null && echo "Redis: PONG" || echo "Redis: Not ready"
        docker exec translator-mongodb-dev mongosh --quiet --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q "true" && echo "MongoDB: Primary" || echo "MongoDB: Not primary"
        echo ""
        echo "Memory Usage:"
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | grep -E "translator|NAME" || echo "No stats available"
        echo ""
        echo "Use: ./scripts/monitor-services.sh --interactive for interactive mode"
        '
    else
        echo "Watch command not available. Running single check..."
        display_monitor
        echo ""
        echo "For continuous monitoring, install watch: brew install watch"
        echo "Or use interactive mode: $0 --interactive"
    fi
fi