#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🚀 Rocket Chat Universal Translator - Startup Check"
echo "=================================================="

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if port is free
check_port() {
    local port=$1
    local service=$2
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ Port $port ($service) is already in use${NC}"
        return 1
    else
        echo -e "${GREEN}✅ Port $port ($service) is available${NC}"
        return 0
    fi
}

# Function to check environment variable
check_env() {
    local var=$1
    local value="${!var}"
    if [ -z "$value" ]; then
        echo -e "${RED}❌ $var is not set${NC}"
        return 1
    else
        echo -e "${GREEN}✅ $var is set${NC}"
        return 0
    fi
}

# 1. Check required tools
echo ""
echo "📋 Checking required tools..."
echo "------------------------------"

TOOLS_OK=true

if command_exists node; then
    NODE_VERSION=$(node -v)
    echo -e "${GREEN}✅ Node.js installed: $NODE_VERSION${NC}"
else
    echo -e "${RED}❌ Node.js is not installed${NC}"
    TOOLS_OK=false
fi

if command_exists npm; then
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}✅ npm installed: $NPM_VERSION${NC}"
else
    echo -e "${RED}❌ npm is not installed${NC}"
    TOOLS_OK=false
fi

if command_exists docker; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | sed 's/,$//')
    echo -e "${GREEN}✅ Docker installed: $DOCKER_VERSION${NC}"
else
    echo -e "${RED}❌ Docker is not installed${NC}"
    TOOLS_OK=false
fi

if command_exists docker-compose || command_exists "docker compose"; then
    if command_exists docker-compose; then
        DC_VERSION=$(docker-compose --version | cut -d' ' -f3 | sed 's/,$//')
    else
        DC_VERSION=$(docker compose version | cut -d' ' -f4)
    fi
    echo -e "${GREEN}✅ Docker Compose installed: $DC_VERSION${NC}"
else
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    TOOLS_OK=false
fi

# 2. Check environment file
echo ""
echo "📋 Checking environment configuration..."
echo "----------------------------------------"

if [ -f .env ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
    source .env
else
    echo -e "${YELLOW}⚠️ .env file not found, using example${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env from .env.example${NC}"
        source .env
    else
        echo -e "${RED}❌ No .env or .env.example found${NC}"
        exit 1
    fi
fi

# 3. Check required environment variables
echo ""
echo "📋 Checking required environment variables..."
echo "--------------------------------------------"

ENV_OK=true

# Required variables
REQUIRED_VARS=(
    "DB_HOST"
    "DB_NAME"
    "DB_USER"
    "DB_PASSWORD"
    "REDIS_HOST"
    "ROCKETCHAT_URL"
    "JWT_SECRET"
    "ENCRYPTION_KEY"
    "INTERNAL_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
    check_env "$var" || ENV_OK=false
done

# 4. Check ports availability
echo ""
echo "📋 Checking port availability..."
echo "--------------------------------"

PORTS_OK=true

check_port 3030 "Rocket.Chat" || PORTS_OK=false
check_port 3001 "API Server" || PORTS_OK=false
check_port 5433 "PostgreSQL" || PORTS_OK=false
check_port 6380 "Redis" || PORTS_OK=false
check_port 27017 "MongoDB" || PORTS_OK=false

# 5. Check workspaces
echo ""
echo "📋 Checking project workspaces..."
echo "---------------------------------"

WORKSPACE_OK=true

if [ -d "shared" ] && [ -f "shared/package.json" ]; then
    echo -e "${GREEN}✅ Shared workspace exists${NC}"
else
    echo -e "${RED}❌ Shared workspace is missing or incomplete${NC}"
    WORKSPACE_OK=false
fi

if [ -d "api" ] && [ -f "api/package.json" ]; then
    echo -e "${GREEN}✅ API workspace exists${NC}"
else
    echo -e "${RED}❌ API workspace is missing or incomplete${NC}"
    WORKSPACE_OK=false
fi

if [ -d "plugin" ] && [ -f "plugin/package.json" ]; then
    echo -e "${GREEN}✅ Plugin workspace exists${NC}"
else
    echo -e "${RED}❌ Plugin workspace is missing or incomplete${NC}"
    WORKSPACE_OK=false
fi

# 6. Check node_modules
echo ""
echo "📋 Checking dependencies installation..."
echo "----------------------------------------"

DEPS_OK=true

if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Root node_modules exists${NC}"
else
    echo -e "${YELLOW}⚠️ Root node_modules missing - run 'npm install'${NC}"
    DEPS_OK=false
fi

if [ -d "api/node_modules" ] || [ -L "api/node_modules" ]; then
    echo -e "${GREEN}✅ API dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️ API dependencies missing${NC}"
    DEPS_OK=false
fi

if [ -d "plugin/node_modules" ] || [ -L "plugin/node_modules" ]; then
    echo -e "${GREEN}✅ Plugin dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️ Plugin dependencies missing${NC}"
    DEPS_OK=false
fi

# 7. Check build status
echo ""
echo "📋 Checking build status..."
echo "---------------------------"

BUILD_OK=true

if [ -d "shared/dist" ]; then
    echo -e "${GREEN}✅ Shared module is built${NC}"
else
    echo -e "${YELLOW}⚠️ Shared module needs building - run 'npm run build'${NC}"
    BUILD_OK=false
fi

if [ -d "api/dist" ]; then
    echo -e "${GREEN}✅ API is built${NC}"
else
    echo -e "${YELLOW}⚠️ API needs building${NC}"
    BUILD_OK=false
fi

if [ -d "plugin/dist" ]; then
    echo -e "${GREEN}✅ Plugin is built${NC}"
else
    echo -e "${YELLOW}⚠️ Plugin needs building${NC}"
    BUILD_OK=false
fi

# Summary
echo ""
echo "=================================================="
echo "📊 STARTUP CHECK SUMMARY"
echo "=================================================="

ALL_OK=true

if [ "$TOOLS_OK" = true ]; then
    echo -e "${GREEN}✅ Required tools: OK${NC}"
else
    echo -e "${RED}❌ Required tools: FAILED${NC}"
    ALL_OK=false
fi

if [ "$ENV_OK" = true ]; then
    echo -e "${GREEN}✅ Environment variables: OK${NC}"
else
    echo -e "${RED}❌ Environment variables: FAILED${NC}"
    ALL_OK=false
fi

if [ "$PORTS_OK" = true ]; then
    echo -e "${GREEN}✅ Port availability: OK${NC}"
else
    echo -e "${YELLOW}⚠️ Port availability: WARNING${NC}"
fi

if [ "$WORKSPACE_OK" = true ]; then
    echo -e "${GREEN}✅ Workspaces: OK${NC}"
else
    echo -e "${RED}❌ Workspaces: FAILED${NC}"
    ALL_OK=false
fi

if [ "$DEPS_OK" = true ]; then
    echo -e "${GREEN}✅ Dependencies: OK${NC}"
else
    echo -e "${YELLOW}⚠️ Dependencies: Need installation${NC}"
fi

if [ "$BUILD_OK" = true ]; then
    echo -e "${GREEN}✅ Build status: OK${NC}"
else
    echo -e "${YELLOW}⚠️ Build status: Needs building${NC}"
fi

echo "=================================================="

# Provide recommendations
if [ "$ALL_OK" = false ] || [ "$DEPS_OK" = false ] || [ "$BUILD_OK" = false ]; then
    echo ""
    echo "📝 RECOMMENDED ACTIONS:"
    echo "-----------------------"

    if [ "$DEPS_OK" = false ]; then
        echo "1. Install dependencies: npm run install:all"
    fi

    if [ "$BUILD_OK" = false ]; then
        echo "2. Build the project: npm run build"
    fi

    if [ "$ENV_OK" = false ]; then
        echo "3. Configure missing environment variables in .env"
    fi

    if [ "$PORTS_OK" = false ]; then
        echo "4. Stop services using conflicting ports or change port configuration"
    fi

    echo ""
    echo "After fixing issues, you can start with:"
    echo "  - Docker: docker-compose -f docker-compose.fixed.yml up"
    echo "  - Local: npm run dev"
else
    echo ""
    echo -e "${GREEN}✅ All checks passed! Ready to start.${NC}"
    echo ""
    echo "Start with:"
    echo "  - Docker: docker-compose -f docker-compose.fixed.yml up"
    echo "  - Local: npm run dev"
fi

echo ""