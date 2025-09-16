#!/bin/bash

set -e

TEST_TYPE=${1:-all}
ENVIRONMENT=${2:-test}
VERBOSE=${3:-false}

echo "🧪 Running tests for Universal Translator"
echo "Test type: $TEST_TYPE"
echo "Environment: $ENVIRONMENT"
echo "Verbose: $VERBOSE"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "info")
            echo -e "${BLUE}ℹ️ $message${NC}"
            ;;
        "success")
            echo -e "${GREEN}✅ $message${NC}"
            ;;
        "warning")
            echo -e "${YELLOW}⚠️ $message${NC}"
            ;;
        "error")
            echo -e "${RED}❌ $message${NC}"
            ;;
    esac
}

# Function to run command with proper logging
run_command() {
    local command=$1
    local description=$2

    print_status "info" "Running: $description"

    if [ "$VERBOSE" = "true" ]; then
        echo "Command: $command"
        echo "---"
    fi

    if eval "$command"; then
        print_status "success" "$description completed"
        return 0
    else
        print_status "error" "$description failed"
        return 1
    fi
}

# Function to check if npm script exists
script_exists() {
    local script=$1
    npm run | grep -q "^  $script$" 2>/dev/null
}

# Function to run tests in a workspace
run_workspace_tests() {
    local workspace=$1
    local test_command=$2

    if [ ! -d "$workspace" ]; then
        print_status "warning" "$workspace directory not found, skipping"
        return 0
    fi

    print_status "info" "Testing $workspace workspace..."

    if [ -f "$workspace/package.json" ]; then
        cd "$workspace"

        if script_exists "$test_command"; then
            run_command "npm run $test_command" "$workspace $test_command"
        else
            print_status "warning" "No $test_command script found in $workspace"
        fi

        cd ..
    else
        print_status "warning" "No package.json found in $workspace"
    fi
}

# Set up test environment
setup_test_env() {
    print_status "info" "Setting up test environment..."

    # Copy environment file if it exists
    if [ -f ".env.example" ] && [ ! -f ".env.test" ]; then
        cp .env.example .env.test
        print_status "info" "Created .env.test from .env.example"
    fi

    # Set test environment variables
    export NODE_ENV=test
    export LOG_LEVEL=error
}

# Lint tests
run_lint_tests() {
    print_status "info" "Running linting tests..."

    # Root lint
    if script_exists "lint"; then
        run_command "npm run lint" "Root linting"
    fi

    # Workspace linting
    for workspace in api plugin shared; do
        run_workspace_tests "$workspace" "lint"
    done
}

# Type check tests
run_type_tests() {
    print_status "info" "Running type checking tests..."

    # Root type check
    if script_exists "typecheck"; then
        run_command "npm run typecheck" "Root type checking"
    fi

    # Workspace type checking
    for workspace in api plugin shared; do
        run_workspace_tests "$workspace" "typecheck"
    done
}

# Unit tests
run_unit_tests() {
    print_status "info" "Running unit tests..."

    # Root unit tests
    if script_exists "test"; then
        run_command "npm test -- --passWithNoTests" "Root unit tests"
    fi

    # Workspace unit tests
    for workspace in api plugin shared; do
        run_workspace_tests "$workspace" "test"
    done
}

# Integration tests
run_integration_tests() {
    print_status "info" "Running integration tests..."

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        print_status "warning" "Docker not found, skipping integration tests"
        return 0
    fi

    # Start test services
    if [ -f "docker-compose.test.yml" ]; then
        print_status "info" "Starting test services..."
        docker-compose -f docker-compose.test.yml up -d postgres-test redis-test

        # Wait for services to be ready
        print_status "info" "Waiting for services to be ready..."
        sleep 10

        # Run integration tests
        if script_exists "test:integration"; then
            run_command "npm run test:integration" "Integration tests"
        else
            print_status "warning" "No integration test script found"
        fi

        # Cleanup
        print_status "info" "Stopping test services..."
        docker-compose -f docker-compose.test.yml down
    else
        print_status "warning" "No docker-compose.test.yml found, skipping integration tests"
    fi
}

# E2E tests
run_e2e_tests() {
    print_status "info" "Running E2E tests..."

    if ! command -v docker &> /dev/null; then
        print_status "warning" "Docker not found, skipping E2E tests"
        return 0
    fi

    if [ -f "docker-compose.test.yml" ]; then
        print_status "info" "Starting full test environment..."
        docker-compose -f docker-compose.test.yml up -d

        # Wait for services
        print_status "info" "Waiting for all services to be ready..."
        sleep 30

        # Run E2E tests
        if script_exists "test:e2e"; then
            run_command "npm run test:e2e" "E2E tests"
        elif [ -d "cypress" ]; then
            run_command "npx cypress run --headless" "Cypress E2E tests"
        elif [ -f "playwright.config.js" ]; then
            run_command "npx playwright test" "Playwright E2E tests"
        else
            print_status "warning" "No E2E test framework found"
        fi

        # Cleanup
        print_status "info" "Stopping test environment..."
        docker-compose -f docker-compose.test.yml down
    else
        print_status "warning" "No docker-compose.test.yml found, skipping E2E tests"
    fi
}

# Performance tests
run_performance_tests() {
    print_status "info" "Running performance tests..."

    if ! command -v docker &> /dev/null; then
        print_status "warning" "Docker not found, skipping performance tests"
        return 0
    fi

    if [ -f "docker-compose.test.yml" ] && [ -d "performance" ]; then
        print_status "info" "Starting services for performance testing..."
        docker-compose -f docker-compose.test.yml up -d api-test postgres-test redis-test

        # Wait for API to be ready
        print_status "info" "Waiting for API to be ready..."
        sleep 20

        # Run performance tests
        if [ -f "performance/api-load-test.js" ]; then
            run_command "docker-compose -f docker-compose.test.yml run --rm load-test" "Load tests"
        else
            print_status "warning" "No performance test scripts found"
        fi

        # Cleanup
        docker-compose -f docker-compose.test.yml down
    else
        print_status "warning" "Performance test setup not found"
    fi
}

# Security tests
run_security_tests() {
    print_status "info" "Running security tests..."

    # npm audit
    if command -v npm &> /dev/null; then
        run_command "npm audit --audit-level=moderate" "npm security audit"
    fi

    # Semgrep scan if available
    if command -v semgrep &> /dev/null; then
        run_command "semgrep --config=auto --error ." "Semgrep security scan"
    fi

    # Docker security scan if available
    if command -v trivy &> /dev/null && [ -f "Dockerfile" ]; then
        run_command "trivy fs ." "Trivy security scan"
    fi
}

# Coverage report
generate_coverage_report() {
    print_status "info" "Generating coverage report..."

    # Collect coverage from all workspaces
    coverage_dirs=()
    for workspace in api plugin shared; do
        if [ -d "$workspace/coverage" ]; then
            coverage_dirs+=("$workspace/coverage")
        fi
    done

    if [ ${#coverage_dirs[@]} -gt 0 ]; then
        print_status "success" "Coverage reports found in: ${coverage_dirs[*]}"

        # Create combined coverage report if nyc is available
        if command -v nyc &> /dev/null; then
            run_command "nyc merge ${coverage_dirs[*]} .nyc_output/coverage.json" "Merge coverage reports"
            run_command "nyc report --reporter=html --reporter=text" "Generate combined coverage report"
        fi
    else
        print_status "warning" "No coverage reports found"
    fi
}

# Main test execution
main() {
    print_status "info" "Starting test suite..."

    setup_test_env

    case $TEST_TYPE in
        "lint")
            run_lint_tests
            ;;
        "type")
            run_type_tests
            ;;
        "unit")
            run_unit_tests
            ;;
        "integration")
            run_integration_tests
            ;;
        "e2e")
            run_e2e_tests
            ;;
        "performance")
            run_performance_tests
            ;;
        "security")
            run_security_tests
            ;;
        "coverage")
            generate_coverage_report
            ;;
        "all")
            run_lint_tests
            run_type_tests
            run_unit_tests
            run_integration_tests
            run_security_tests
            generate_coverage_report
            ;;
        "ci")
            # CI-specific test suite (faster, no E2E)
            run_lint_tests
            run_type_tests
            run_unit_tests
            run_security_tests
            ;;
        "full")
            # Full test suite including E2E and performance
            run_lint_tests
            run_type_tests
            run_unit_tests
            run_integration_tests
            run_e2e_tests
            run_performance_tests
            run_security_tests
            generate_coverage_report
            ;;
        *)
            print_status "error" "Unknown test type: $TEST_TYPE"
            echo ""
            echo "Available test types:"
            echo "  lint        - Run linting tests"
            echo "  type        - Run type checking"
            echo "  unit        - Run unit tests"
            echo "  integration - Run integration tests"
            echo "  e2e         - Run E2E tests"
            echo "  performance - Run performance tests"
            echo "  security    - Run security scans"
            echo "  coverage    - Generate coverage report"
            echo "  ci          - Run CI test suite (lint, type, unit, security)"
            echo "  all         - Run all tests except E2E and performance"
            echo "  full        - Run complete test suite"
            exit 1
            ;;
    esac

    print_status "success" "Test suite completed!"
}

# Trap cleanup
cleanup() {
    print_status "info" "Cleaning up..."
    if command -v docker-compose &> /dev/null && [ -f "docker-compose.test.yml" ]; then
        docker-compose -f docker-compose.test.yml down > /dev/null 2>&1 || true
    fi
}

trap cleanup EXIT

# Run main function
main