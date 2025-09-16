#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Running Complete Performance Test Suite${NC}"
echo "============================================="

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="./test-results-$TIMESTAMP"
mkdir -p "$RESULTS_DIR"

# Function to check if services are running
check_services() {
    echo -e "${YELLOW}📋 Checking service availability...${NC}"

    # Check Translation API
    if curl -s -f http://192.168.110.199:3012/healthz > /dev/null; then
        echo -e "${GREEN}✅ Translation API is running${NC}"
    else
        echo -e "${RED}❌ Translation API is not responding${NC}"
        echo "Please start services with: docker-compose -f ../docker-compose.dev.yml up -d"
        exit 1
    fi

    # Check Rocket.Chat
    if curl -s -f http://192.168.110.199:3013/api/info > /dev/null; then
        echo -e "${GREEN}✅ Rocket.Chat is running${NC}"
    else
        echo -e "${YELLOW}⚠️  Rocket.Chat is not responding (Rocket.Chat tests will be skipped)${NC}"
    fi

    # Check Docker containers
    local containers=("translator-postgres-dev" "translator-redis-dev" "translator-mongodb-dev")
    for container in "${containers[@]}"; do
        if docker ps --format "table {{.Names}}" | grep -q "^$container\$"; then
            echo -e "${GREEN}✅ $container is running${NC}"
        else
            echo -e "${YELLOW}⚠️  $container is not running (some database tests may fail)${NC}"
        fi
    done

    echo ""
}

# Function to run k6 tests with error handling
run_k6_test() {
    local test_name=$1
    local test_file=$2
    local duration=$3
    local output_format=${4:-"json"}

    echo -e "${PURPLE}🧪 Running $test_name...${NC}"
    echo "Test file: $test_file"
    echo "Expected duration: ~$duration"
    echo ""

    local output_file="$RESULTS_DIR/${test_file%.*}-results-$TIMESTAMP"

    if [ "$output_format" = "html" ]; then
        output_file="${output_file}.html"
        k6 run --out html="$output_file" "$test_file" 2>&1 | tee "$RESULTS_DIR/${test_file%.*}-console-$TIMESTAMP.log"
    else
        output_file="${output_file}.json"
        k6 run --out json="$output_file" "$test_file" 2>&1 | tee "$RESULTS_DIR/${test_file%.*}-console-$TIMESTAMP.log"
    fi

    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✅ $test_name completed successfully${NC}"
        echo "Results saved to: $(basename "$output_file")"
    else
        echo -e "${RED}❌ $test_name failed with exit code $exit_code${NC}"
        echo "Check console log: ${test_file%.*}-console-$TIMESTAMP.log"
    fi

    echo ""
    return $exit_code
}

# Function to run database performance tests
run_database_tests() {
    echo -e "${PURPLE}🗄️  Running Database Performance Tests...${NC}"

    if [ -x "./database-performance-test.sh" ]; then
        ./database-performance-test.sh 2>&1 | tee "$RESULTS_DIR/database-performance-$TIMESTAMP.log"

        # Move database results to our results directory
        if [ -d "performance-results" ]; then
            cp -r performance-results/* "$RESULTS_DIR/" 2>/dev/null || true
        fi

        echo -e "${GREEN}✅ Database performance tests completed${NC}"
    else
        echo -e "${RED}❌ Database performance test script not found or not executable${NC}"
    fi

    echo ""
}

# Main test execution
main() {
    echo -e "${BLUE}📊 Performance Test Suite Started at $(date)${NC}"
    echo "Results directory: $RESULTS_DIR"
    echo ""

    # Check prerequisites
    if ! command -v k6 &> /dev/null && ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Neither k6 nor Docker is available. Please install k6 first.${NC}"
        echo "Run: ./install-k6.sh"
        exit 1
    fi

    # Check services
    check_services

    # Array to track test results
    declare -a test_results

    # 1. API Load Test (JSON output for analysis)
    if [ -f "api-load-test.js" ]; then
        run_k6_test "API Load Test" "api-load-test.js" "16 minutes" "json"
        test_results+=($?)
    else
        echo -e "${RED}❌ api-load-test.js not found${NC}"
        test_results+=(1)
    fi

    # 2. API Load Test (HTML output for visualization)
    if [ -f "api-load-test.js" ]; then
        run_k6_test "API Load Test (HTML Report)" "api-load-test.js" "16 minutes" "html"
        test_results+=($?)
    fi

    # 3. Memory Leak Test
    if [ -f "memory-leak-test.js" ]; then
        run_k6_test "Memory Leak Detection Test" "memory-leak-test.js" "15 minutes" "json"
        test_results+=($?)
    else
        echo -e "${RED}❌ memory-leak-test.js not found${NC}"
        test_results+=(1)
    fi

    # 4. Rocket.Chat Load Test (if service is available)
    if curl -s -f http://192.168.110.199:3013/api/info > /dev/null && [ -f "rocketchat-load-test.js" ]; then
        run_k6_test "Rocket.Chat Load Test" "rocketchat-load-test.js" "11 minutes" "json"
        test_results+=($?)
    else
        echo -e "${YELLOW}⚠️  Skipping Rocket.Chat tests (service not available or test file missing)${NC}"
        test_results+=(0)  # Mark as passed since it's optional
    fi

    # 5. Database Performance Tests
    run_database_tests
    test_results+=($?)

    # Calculate overall results
    local total_tests=${#test_results[@]}
    local failed_tests=0

    for result in "${test_results[@]}"; do
        if [ $result -ne 0 ]; then
            ((failed_tests++))
        fi
    done

    local passed_tests=$((total_tests - failed_tests))

    echo -e "${BLUE}📊 Test Suite Summary${NC}"
    echo "===================="
    echo -e "Total tests: $total_tests"
    echo -e "${GREEN}Passed: $passed_tests${NC}"
    echo -e "${RED}Failed: $failed_tests${NC}"
    echo ""

    # Run analysis
    echo -e "${PURPLE}🔍 Running Results Analysis...${NC}"
    if [ -x "./analyze-results.sh" ]; then
        # Copy result files to current directory for analysis
        cp "$RESULTS_DIR"/*.json . 2>/dev/null || true
        cp "$RESULTS_DIR"/*.html . 2>/dev/null || true

        ./analyze-results.sh 2>&1 | tee "$RESULTS_DIR/analysis-$TIMESTAMP.log"

        # Move analysis results to results directory
        mv performance-analysis-report-*.md "$RESULTS_DIR/" 2>/dev/null || true
    else
        echo -e "${YELLOW}⚠️  Analysis script not found or not executable${NC}"
    fi

    echo ""
    echo -e "${BLUE}📁 All Results Saved To: $RESULTS_DIR${NC}"
    echo "Files generated:"
    find "$RESULTS_DIR" -type f | sort | while read -r file; do
        echo "  • $(basename "$file")"
    done

    echo ""
    if [ $failed_tests -eq 0 ]; then
        echo -e "${GREEN}🎉 All performance tests completed successfully!${NC}"

        echo -e "\n${YELLOW}📋 Next Steps:${NC}"
        echo "1. Review the HTML performance report in your browser"
        echo "2. Check the comprehensive analysis report"
        echo "3. Implement recommended optimizations"
        echo "4. Set up continuous performance monitoring"

        exit 0
    else
        echo -e "${RED}⚠️  Some tests failed. Please review the results and logs.${NC}"

        echo -e "\n${YELLOW}🔧 Troubleshooting:${NC}"
        echo "1. Check service availability with: docker-compose ps"
        echo "2. Review console logs for specific error messages"
        echo "3. Verify network connectivity to test endpoints"
        echo "4. Check system resources (memory, CPU)"

        exit 1
    fi
}

# Trap to clean up on exit
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up temporary files...${NC}"
    # Remove any temporary files if needed
}
trap cleanup EXIT

# Help function
show_help() {
    cat << EOF
Performance Test Suite Runner

Usage: $0 [OPTIONS]

OPTIONS:
    -h, --help          Show this help message
    -q, --quick         Run only essential tests (API load test)
    --api-only          Run only API load tests
    --memory-only       Run only memory leak tests
    --db-only           Run only database tests
    --no-analysis       Skip automatic analysis

EXAMPLES:
    $0                  Run complete test suite
    $0 --quick          Run quick performance check
    $0 --api-only       Test only API performance
    $0 --memory-only    Test only for memory leaks

PREREQUISITES:
    - k6 load testing tool installed
    - Docker services running
    - Translation API accessible on port 3012
    - (Optional) Rocket.Chat accessible on port 3013

For installation help: ./install-k6.sh
EOF
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    --quick)
        echo "Running quick performance test..."
        # Run only API load test
        check_services
        run_k6_test "Quick API Load Test" "api-load-test.js" "16 minutes" "html"
        exit $?
        ;;
    --api-only)
        echo "Running API performance tests only..."
        check_services
        run_k6_test "API Load Test" "api-load-test.js" "16 minutes" "json"
        ./analyze-results.sh
        exit $?
        ;;
    --memory-only)
        echo "Running memory leak tests only..."
        check_services
        run_k6_test "Memory Leak Test" "memory-leak-test.js" "15 minutes" "json"
        exit $?
        ;;
    --db-only)
        echo "Running database tests only..."
        run_database_tests
        exit $?
        ;;
    "")
        # Run all tests
        main
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac