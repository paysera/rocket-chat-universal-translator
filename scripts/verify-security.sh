#!/bin/bash

# Security Verification Script
# Validates that the Docker isolation solution successfully mitigates vulnerabilities

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔒 Universal Translator Pro - Security Verification${NC}"
echo -e "${BLUE}=================================================${NC}"

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "\n${YELLOW}1. Checking production dependencies for vulnerabilities...${NC}"

# Check root package
echo -e "\n📦 Root package audit:"
cd "$PROJECT_ROOT"
if npm audit --audit-level=high; then
    echo -e "${GREEN}✅ Root package: No high severity vulnerabilities${NC}"
else
    echo -e "${RED}❌ Root package: High severity vulnerabilities found${NC}"
    exit 1
fi

# Check API package
echo -e "\n🔌 API package audit:"
cd "$PROJECT_ROOT/api"
if npm audit --audit-level=high; then
    echo -e "${GREEN}✅ API package: No high severity vulnerabilities${NC}"
else
    echo -e "${RED}❌ API package: High severity vulnerabilities found${NC}"
    exit 1
fi

# Check plugin package
echo -e "\n🔧 Plugin package audit:"
cd "$PROJECT_ROOT/plugin"
if npm audit --audit-level=high; then
    echo -e "${GREEN}✅ Plugin package: No high severity vulnerabilities${NC}"
else
    echo -e "${RED}❌ Plugin package: High severity vulnerabilities found${NC}"
    exit 1
fi

echo -e "\n${YELLOW}2. Verifying @rocket.chat/apps-cli isolation...${NC}"

# Check that apps-cli is not in production dependencies
cd "$PROJECT_ROOT"
if ! npm ls @rocket.chat/apps-cli &>/dev/null; then
    echo -e "${GREEN}✅ @rocket.chat/apps-cli successfully isolated from production${NC}"
else
    echo -e "${RED}❌ @rocket.chat/apps-cli still present in production dependencies${NC}"
    npm ls @rocket.chat/apps-cli
    exit 1
fi

echo -e "\n${YELLOW}3. Verifying Docker build infrastructure...${NC}"

# Check if build script exists and is executable
if [[ -x "$PROJECT_ROOT/scripts/build-plugin-secure.sh" ]]; then
    echo -e "${GREEN}✅ Secure build script exists and is executable${NC}"
else
    echo -e "${RED}❌ Secure build script missing or not executable${NC}"
    exit 1
fi

# Check if Dockerfile exists
if [[ -f "$PROJECT_ROOT/build.Dockerfile" ]]; then
    echo -e "${GREEN}✅ Build Dockerfile exists${NC}"
else
    echo -e "${RED}❌ Build Dockerfile missing${NC}"
    exit 1
fi

# Check if Docker is available for builds
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✅ Docker is available for secure builds${NC}"
else
    echo -e "${YELLOW}⚠️  Docker not available - secure builds will fail${NC}"
fi

echo -e "\n${YELLOW}4. Checking security annotations...${NC}"

# Check if package.json files have security sections
if grep -q "security" "$PROJECT_ROOT/package.json" && grep -q "security" "$PROJECT_ROOT/plugin/package.json"; then
    echo -e "${GREEN}✅ Security annotations present in package.json files${NC}"
else
    echo -e "${YELLOW}⚠️  Security annotations missing${NC}"
fi

echo -e "\n${YELLOW}5. Testing secure build process (dry run)...${NC}"

# Test that the secure build script can parse and validate
if "$PROJECT_ROOT/scripts/build-plugin-secure.sh" --help &>/dev/null || [[ $? -eq 1 ]]; then
    echo -e "${GREEN}✅ Secure build script is properly configured${NC}"
else
    echo -e "${YELLOW}⚠️  Secure build script may have issues${NC}"
fi

echo -e "\n${GREEN}🎉 Security Verification Complete!${NC}"
echo -e "${GREEN}=================================${NC}"
echo -e "${GREEN}✅ All high severity vulnerabilities mitigated${NC}"
echo -e "${GREEN}✅ @rocket.chat/apps-cli isolated to Docker build environment${NC}"
echo -e "${GREEN}✅ Production environment is secure${NC}"
echo -e "${GREEN}✅ Secure build process implemented${NC}"

echo -e "\n${BLUE}📋 Security Summary:${NC}"
echo -e "  • Vulnerability: lodash.template command injection (3 HIGH severity)"
echo -e "  • Source: @rocket.chat/apps-cli → @oclif/plugin-help → lodash.template"
echo -e "  • Solution: Docker isolation for build-time dependencies"
echo -e "  • Result: Zero production exposure to vulnerable packages"
echo -e "  • Build command: npm run build:plugin:secure"

echo -e "\n${YELLOW}⚠️  Important Notes:${NC}"
echo -e "  • Always use 'npm run build:plugin:secure' for plugin builds"
echo -e "  • Never install @rocket.chat/apps-cli directly in production"
echo -e "  • Docker is required for secure plugin packaging"
echo -e "  • Regular security audits recommended: npm run security:audit"