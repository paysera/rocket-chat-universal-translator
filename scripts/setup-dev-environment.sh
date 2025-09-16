#!/bin/bash

set -e

echo "🚀 Setting up Universal Translator development environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    local status=$1
    local message=$2
    case $status in
        "info") echo -e "${BLUE}ℹ️ $message${NC}" ;;
        "success") echo -e "${GREEN}✅ $message${NC}" ;;
        "warning") echo -e "${YELLOW}⚠️ $message${NC}" ;;
        "error") echo -e "${RED}❌ $message${NC}" ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d ".git" ]; then
    print_status "error" "Please run this script from the project root directory"
    exit 1
fi

print_status "info" "Checking system requirements..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    print_status "error" "Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | cut -d'v' -f2)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_status "warning" "Node.js version $NODE_VERSION detected. Recommended version is 18+."
fi

print_status "success" "Node.js $(node -v) detected"

# Check npm
if ! command -v npm &> /dev/null; then
    print_status "error" "npm is not installed"
    exit 1
fi

print_status "success" "npm $(npm -v) detected"

# Check Docker (optional but recommended)
if command -v docker &> /dev/null; then
    print_status "success" "Docker $(docker --version | cut -d' ' -f3) detected"
    DOCKER_AVAILABLE=true
else
    print_status "warning" "Docker not found. Some features will be limited."
    DOCKER_AVAILABLE=false
fi

print_status "info" "Installing dependencies..."

# Install root dependencies
npm install

# Install workspace dependencies
print_status "info" "Installing workspace dependencies..."
npm run install:all

print_status "success" "Dependencies installed"

# Setup environment files
print_status "info" "Setting up environment files..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_status "success" "Created .env from .env.example"
    else
        print_status "warning" "No .env.example found, creating basic .env"
        cat > .env << EOF
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=translator_dev
DB_USER=translator
DB_PASSWORD=translator123
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=dev-secret-key
EOF
    fi
else
    print_status "info" ".env already exists, skipping"
fi

# Create test environment file
if [ ! -f ".env.test" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env.test
        # Override with test-specific values
        sed -i.bak 's/NODE_ENV=.*/NODE_ENV=test/' .env.test
        sed -i.bak 's/LOG_LEVEL=.*/LOG_LEVEL=error/' .env.test
        sed -i.bak 's/DB_NAME=.*/DB_NAME=translator_test/' .env.test
        rm -f .env.test.bak
        print_status "success" "Created .env.test"
    fi
fi

# Setup pre-commit hooks
print_status "info" "Setting up pre-commit hooks..."
if ./scripts/setup-pre-commit.sh; then
    print_status "success" "Pre-commit hooks configured"
else
    print_status "warning" "Pre-commit setup failed, continuing without hooks"
fi

# Run initial build
print_status "info" "Running initial build..."
if npm run build; then
    print_status "success" "Build completed successfully"
else
    print_status "warning" "Build failed, but continuing setup"
fi

# Run tests to verify setup
print_status "info" "Running tests to verify setup..."
if npm run test:ci; then
    print_status "success" "All tests passed"
else
    print_status "warning" "Some tests failed, but environment is set up"
fi

# Setup Docker environment if available
if [ "$DOCKER_AVAILABLE" = true ]; then
    print_status "info" "Setting up Docker development environment..."

    # Build Docker images
    if docker-compose -f docker-compose.dev.yml build > /dev/null 2>&1; then
        print_status "success" "Docker development images built"
    else
        print_status "warning" "Docker build failed, manual setup may be required"
    fi
fi

print_status "success" "Development environment setup completed!"

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo "   1. Review and update .env file with your settings"
echo "   2. Start development: npm run dev"
echo "   3. Run tests: npm run test"
echo "   4. Check code quality: npm run lint"
echo ""

if [ "$DOCKER_AVAILABLE" = true ]; then
    echo "🐳 Docker Commands:"
    echo "   - Start dev environment: npm run docker:dev"
    echo "   - Run tests in Docker: npm run docker:test"
    echo "   - View logs: docker-compose logs -f"
    echo ""
fi

echo "📚 Useful Commands:"
echo "   - npm run dev                 # Start development servers"
echo "   - npm run test:ci             # Run CI test suite"
echo "   - npm run test:integration    # Run integration tests"
echo "   - npm run lint:fix            # Fix linting issues"
echo "   - npm run typecheck           # Check TypeScript types"
echo ""

echo "🔗 Important URLs (when running):"
echo "   - API: http://localhost:3000"
echo "   - Plugin dev: http://localhost:3001"
echo "   - Database: postgresql://localhost:5432/translator_dev"
echo "   - Redis: redis://localhost:6379"
echo ""

echo "🆘 Need Help?"
echo "   - Check README.md for detailed documentation"
echo "   - Review CI_CD_SETUP.md for CI/CD information"
echo "   - Check .github/PULL_REQUEST_TEMPLATE.md for contribution guidelines"
echo ""

print_status "success" "Happy coding! 🚀"