#!/bin/bash

# Performance Testing CI Script for Universal Translator
# Runs comprehensive performance tests suitable for CI/CD pipelines

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://192.168.110.199:3012}"
RESULTS_DIR="results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REPORT_DIR="performance-reports/${TIMESTAMP}"
CI_MODE="${CI_MODE:-false}"

# CI-friendly test configuration (shorter duration, lower load)
if [[ "${CI_MODE}" == "true" ]]; then
    TARGET_USERS=25
    TEST_DURATION="2m"
    CONCURRENT_USERS=50
    echo -e "${BLUE}🔧 Running in CI mode with reduced load${NC}"
else
    TARGET_USERS=100
    TEST_DURATION="5m"
    CONCURRENT_USERS=100
    echo -e "${BLUE}🔧 Running in full performance mode${NC}"
fi

echo -e "${GREEN}🚀 Starting Universal Translator Performance Testing Suite${NC}"
echo -e "${BLUE}📊 Configuration:${NC}"
echo -e "   Base URL: ${BASE_URL}"
echo -e "   Target Users: ${TARGET_USERS}"
echo -e "   Test Duration: ${TEST_DURATION}"
echo -e "   Results Directory: ${RESULTS_DIR}"
echo -e "   Report Directory: ${REPORT_DIR}"

# Create results and reports directories
mkdir -p "${RESULTS_DIR}"
mkdir -p "${REPORT_DIR}"

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 is not installed. Installing...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install k6
        else
            echo -e "${RED}❌ Homebrew not found. Please install k6 manually: https://k6.io/docs/getting-started/installation/${NC}"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux
        sudo apt-get update && sudo apt-get install -y k6
    else
        echo -e "${RED}❌ Unsupported OS. Please install k6 manually: https://k6.io/docs/getting-started/installation/${NC}"
        exit 1
    fi
fi

# Check service health before starting tests
echo -e "${BLUE}🔍 Checking service health...${NC}"
if ! curl -f -s "${BASE_URL}/healthz" > /dev/null; then
    echo -e "${RED}❌ Service at ${BASE_URL} is not responding to health checks${NC}"
    echo -e "${YELLOW}💡 Please ensure the API service is running before running performance tests${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Service health check passed${NC}"

# Initialize test results summary
TEST_RESULTS=()
FAILED_TESTS=0
TOTAL_TESTS=0

# Function to run a performance test
run_test() {
    local test_name="$1"
    local test_file="$2"
    local test_env="$3"
    local output_file="${RESULTS_DIR}/${test_name}-${TIMESTAMP}"

    echo -e "${BLUE}🧪 Running ${test_name}...${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    # Set environment variables and run test
    if eval "${test_env}" k6 run \
        --out json="${output_file}.json" \
        --out html="${output_file}.html" \
        "${test_file}"; then
        echo -e "${GREEN}✅ ${test_name} completed successfully${NC}"
        TEST_RESULTS+=("✅ ${test_name}: PASSED")
    else
        echo -e "${RED}❌ ${test_name} failed${NC}"
        TEST_RESULTS+=("❌ ${test_name}: FAILED")
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi

    # Copy HTML report to reports directory
    if [[ -f "${output_file}.html" ]]; then
        cp "${output_file}.html" "${REPORT_DIR}/"
    fi
}

# Test 1: Enhanced API Load Test
run_test "Enhanced API Load Test" \
         "enhanced-api-load-test.js" \
         "BASE_URL=${BASE_URL} TARGET_USERS=${TARGET_USERS} TEST_DURATION=${TEST_DURATION}"

# Test 2: Concurrent Users Test (reduced for CI)
run_test "Concurrent Users Test" \
         "concurrent-users-test.js" \
         "BASE_URL=${BASE_URL} CONCURRENT_USERS=${CONCURRENT_USERS}"

# Test 3: Cache Effectiveness Test
run_test "Cache Effectiveness Test" \
         "cache-effectiveness-test.js" \
         "BASE_URL=${BASE_URL}"

# Test 4: Resource Monitoring Test (shorter duration for CI)
if [[ "${CI_MODE}" != "true" ]]; then
    run_test "Resource Monitoring Test" \
             "resource-monitoring-test.js" \
             "BASE_URL=${BASE_URL} MONITORING_INTERVAL=5"
else
    echo -e "${YELLOW}⏭️  Skipping Resource Monitoring Test in CI mode${NC}"
fi

# Generate performance benchmarks file
echo -e "${BLUE}📈 Generating performance benchmarks...${NC}"
cat > "${REPORT_DIR}/performance-benchmarks.json" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "environment": {
    "base_url": "${BASE_URL}",
    "target_users": ${TARGET_USERS},
    "test_duration": "${TEST_DURATION}",
    "ci_mode": ${CI_MODE}
  },
  "thresholds": {
    "response_time_p95": 500,
    "response_time_p99": 1000,
    "error_rate_max": 0.1,
    "cache_hit_rate_min": 0.3,
    "memory_usage_max_mb": 2048,
    "cpu_usage_max_percent": 80
  },
  "test_results": {
    "total_tests": ${TOTAL_TESTS},
    "passed_tests": $((TOTAL_TESTS - FAILED_TESTS)),
    "failed_tests": ${FAILED_TESTS},
    "success_rate": $(echo "scale=2; $((TOTAL_TESTS - FAILED_TESTS)) * 100 / ${TOTAL_TESTS}" | bc -l)
  }
}
EOF

# Create performance summary report
echo -e "${BLUE}📝 Creating performance summary report...${NC}"
cat > "${REPORT_DIR}/performance-summary.md" <<EOF
# Performance Test Summary

**Date:** $(date)
**Environment:** ${BASE_URL}
**CI Mode:** ${CI_MODE}

## Test Results Overview

- **Total Tests:** ${TOTAL_TESTS}
- **Passed:** $((TOTAL_TESTS - FAILED_TESTS))
- **Failed:** ${FAILED_TESTS}
- **Success Rate:** $(echo "scale=1; $((TOTAL_TESTS - FAILED_TESTS)) * 100 / ${TOTAL_TESTS}" | bc -l)%

## Individual Test Results

$(printf '%s\n' "${TEST_RESULTS[@]}")

## Performance Thresholds

| Metric | Threshold | Status |
|--------|-----------|---------|
| Response Time P95 | < 500ms | To be analyzed |
| Response Time P99 | < 1000ms | To be analyzed |
| Error Rate | < 10% | To be analyzed |
| Cache Hit Rate | > 30% | To be analyzed |
| Memory Usage | < 2GB | To be analyzed |
| CPU Usage | < 80% | To be analyzed |

## Test Files Generated

- Enhanced API Load Test: [enhanced-api-load-test-${TIMESTAMP}.html](./enhanced-api-load-test-${TIMESTAMP}.html)
- Concurrent Users Test: [concurrent-users-test-${TIMESTAMP}.html](./concurrent-users-test-${TIMESTAMP}.html)
- Cache Effectiveness Test: [cache-effectiveness-test-${TIMESTAMP}.html](./cache-effectiveness-test-${TIMESTAMP}.html)
$(if [[ "${CI_MODE}" != "true" ]]; then echo "- Resource Monitoring Test: [resource-monitoring-test-${TIMESTAMP}.html](./resource-monitoring-test-${TIMESTAMP}.html)"; fi)

## Next Steps

1. Review individual test reports for detailed metrics
2. Compare results with previous baseline performance
3. Investigate any failed tests or performance degradations
4. Update performance baselines if improvements are confirmed

## Access Reports

- **Local Reports:** \`cd performance/performance-reports/${TIMESTAMP}\`
- **Web Reports:** Open HTML files in browser for interactive analysis
- **Raw Data:** JSON files contain detailed metrics for programmatic analysis

EOF

# Performance threshold analysis
echo -e "${BLUE}🔍 Analyzing performance thresholds...${NC}"

# Function to extract metrics from k6 JSON output
analyze_json_results() {
    local json_file="$1"
    local test_name="$2"

    if [[ -f "$json_file" ]]; then
        echo -e "${BLUE}📊 Analyzing ${test_name} results...${NC}"

        # Extract key metrics using jq if available
        if command -v jq &> /dev/null; then
            local p95_time=$(jq -r '.metrics.http_req_duration.values.p95' "$json_file" 2>/dev/null || echo "N/A")
            local error_rate=$(jq -r '.metrics.http_req_failed.values.rate' "$json_file" 2>/dev/null || echo "N/A")

            echo "   P95 Response Time: ${p95_time}ms"
            echo "   Error Rate: ${error_rate}"

            # Simple threshold checking
            if [[ "$p95_time" != "N/A" ]] && (( $(echo "$p95_time > 500" | bc -l) )); then
                echo -e "${YELLOW}   ⚠️  P95 response time exceeds 500ms threshold${NC}"
            fi

            if [[ "$error_rate" != "N/A" ]] && (( $(echo "$error_rate > 0.1" | bc -l) )); then
                echo -e "${YELLOW}   ⚠️  Error rate exceeds 10% threshold${NC}"
            fi
        else
            echo "   jq not available for detailed analysis"
        fi
    fi
}

# Analyze results for each test
for result_file in "${RESULTS_DIR}"/*-${TIMESTAMP}.json; do
    if [[ -f "$result_file" ]]; then
        test_name=$(basename "$result_file" .json | sed "s/-${TIMESTAMP}$//")
        analyze_json_results "$result_file" "$test_name"
    fi
done

# Final summary
echo -e "\n${GREEN}📊 Performance Testing Complete!${NC}"
echo -e "${BLUE}📈 Test Summary:${NC}"
echo -e "   Total Tests: ${TOTAL_TESTS}"
echo -e "   Passed: $((TOTAL_TESTS - FAILED_TESTS))"
echo -e "   Failed: ${FAILED_TESTS}"

if [[ ${FAILED_TESTS} -eq 0 ]]; then
    echo -e "${GREEN}✅ All performance tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ ${FAILED_TESTS} performance test(s) failed${NC}"
    echo -e "${YELLOW}📋 Review the detailed reports in: ${REPORT_DIR}${NC}"

    if [[ "${CI_MODE}" == "true" ]]; then
        exit 1  # Fail CI build if tests failed
    else
        exit 0  # Don't fail in development mode
    fi
fi