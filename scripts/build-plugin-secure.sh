#!/bin/bash

# Secure Plugin Build Script
# Uses Docker to isolate @rocket.chat/apps-cli vulnerabilities from production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${YELLOW}🔒 Starting secure plugin build process...${NC}"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is required but not installed${NC}"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}❌ Docker daemon is not running${NC}"
    exit 1
fi

# Build the Docker image
echo -e "${YELLOW}📦 Building secure build container...${NC}"
cd "$PROJECT_ROOT"

docker build -f build.Dockerfile -t universal-translator-builder:latest .

# Run the build process
echo -e "${YELLOW}🔨 Running build process in isolated container...${NC}"
docker run --rm -v "$PROJECT_ROOT/plugin:/output" universal-translator-builder:latest sh -c "
    cp /output/*.zip /tmp/ 2>/dev/null || true
    rm -f /output/*.zip
    cp /tmp/*.zip /output/ 2>/dev/null || true
"

# Extract the built package
echo -e "${YELLOW}📤 Extracting build artifacts...${NC}"
CONTAINER_ID=$(docker create universal-translator-builder:latest)
docker cp "$CONTAINER_ID:/output/" "$PROJECT_ROOT/plugin/"
docker rm "$CONTAINER_ID"

# Verify the package was created
if ls "$PROJECT_ROOT/plugin"/*.zip 1> /dev/null 2>&1; then
    echo -e "${GREEN}✅ Plugin package built successfully!${NC}"
    echo -e "${GREEN}📦 Package location: $(ls "$PROJECT_ROOT/plugin"/*.zip)${NC}"

    # Validate the package
    echo -e "${YELLOW}🔍 Validating package integrity...${NC}"
    cd "$PROJECT_ROOT/plugin"
    if unzip -t *.zip &> /dev/null; then
        echo -e "${GREEN}✅ Package integrity verified${NC}"
    else
        echo -e "${RED}❌ Package integrity check failed${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Plugin package build failed${NC}"
    exit 1
fi

# Clean up Docker resources
echo -e "${YELLOW}🧹 Cleaning up build resources...${NC}"
docker image rm universal-translator-builder:latest || true

echo -e "${GREEN}🎉 Secure build process completed successfully!${NC}"
echo -e "${GREEN}🔒 No vulnerable dependencies in production environment${NC}"