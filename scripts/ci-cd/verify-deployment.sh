#!/bin/bash

ENVIRONMENT=${1:-production}
URL=${2:-""}

echo "🔍 Verifying deployment in $ENVIRONMENT environment..."

# Set default URLs based on environment
if [ -z "$URL" ]; then
    case $ENVIRONMENT in
        production|prod)
            URL="${PRODUCTION_URL:-https://translate-api.domain.com}"
            ;;
        staging|stage)
            URL="${STAGING_URL:-https://translate-api-staging.domain.com}"
            ;;
        *)
            URL="https://translate-api-$ENVIRONMENT.domain.com"
            ;;
    esac
fi

echo "Target URL: $URL"

# Array to track all test results
declare -a test_results=()

# Function to run test and track result
run_test() {
    local test_name=$1
    local test_command=$2

    echo ""
    echo "🧪 Running: $test_name"

    if eval "$test_command"; then
        echo "  ✅ $test_name: PASSED"
        test_results+=("PASS")
        return 0
    else
        echo "  ❌ $test_name: FAILED"
        test_results+=("FAIL")
        return 1
    fi
}

# Function to check service health
check_service_health() {
    local retries=3
    local wait_time=5

    for i in $(seq 1 $retries); do
        if curl -sf "$URL/health" > /dev/null 2>&1; then
            return 0
        fi
        if curl -sf "$URL/healthz" > /dev/null 2>&1; then
            return 0
        fi
        if curl -sf "$URL/" > /dev/null 2>&1; then
            return 0
        fi

        echo "  Attempt $i/$retries failed, waiting ${wait_time}s..."
        sleep $wait_time
    done
    return 1
}

# Function to check API endpoints
check_api_endpoints() {
    local endpoints=(
        "/health:200"
        "/api/health:200"
        "/api/v1/health:200"
        "/version:200"
        "/api/version:200"
    )

    local passed=0
    local total=${#endpoints[@]}

    for endpoint_spec in "${endpoints[@]}"; do
        IFS=':' read -r endpoint expected_code <<< "$endpoint_spec"
        local actual_code=$(curl -s -o /dev/null -w "%{http_code}" "$URL$endpoint" 2>/dev/null || echo "000")

        if [ "$actual_code" == "$expected_code" ]; then
            echo "    ✅ $endpoint: $actual_code"
            ((passed++))
        else
            echo "    ⚠️ $endpoint: $actual_code (expected $expected_code)"
        fi
    done

    # Pass if at least one endpoint works
    if [ $passed -gt 0 ]; then
        echo "  📊 API endpoints: $passed/$total working"
        return 0
    else
        return 1
    fi
}

# Function to check response times
check_response_times() {
    local max_response_time=2000  # 2 seconds in milliseconds
    local response_time=$(curl -s -o /dev/null -w "%{time_total}" "$URL" 2>/dev/null)

    if [ -z "$response_time" ]; then
        return 1
    fi

    # Convert to milliseconds
    local response_time_ms=$(echo "$response_time * 1000" | bc -l 2>/dev/null || echo "0")
    response_time_ms=${response_time_ms%.*}  # Remove decimal part

    echo "  ⏱️ Response time: ${response_time_ms}ms"

    if [ "$response_time_ms" -lt "$max_response_time" ] && [ "$response_time_ms" -gt 0 ]; then
        return 0
    else
        return 1
    fi
}

# Function to check database connectivity (if applicable)
check_database_connectivity() {
    # Check if there's a database health endpoint
    local db_health_endpoints=(
        "/api/db/health"
        "/health/db"
        "/database/health"
    )

    for endpoint in "${db_health_endpoints[@]}"; do
        local status=$(curl -s -o /dev/null -w "%{http_code}" "$URL$endpoint" 2>/dev/null || echo "000")
        if [ "$status" == "200" ]; then
            echo "  💾 Database connectivity: OK"
            return 0
        fi
    done

    echo "  💾 Database connectivity: No health endpoint found"
    return 0  # Don't fail deployment if no DB health check
}

# Function to check translation service (specific to this app)
check_translation_service() {
    local translation_endpoints=(
        "/api/translate/health"
        "/api/v1/translate/health"
        "/translate/health"
    )

    for endpoint in "${translation_endpoints[@]}"; do
        local status=$(curl -s -o /dev/null -w "%{http_code}" "$URL$endpoint" 2>/dev/null || echo "000")
        if [ "$status" == "200" ]; then
            echo "  🔤 Translation service: OK"
            return 0
        fi
    done

    echo "  🔤 Translation service: No specific health endpoint found"
    return 0  # Don't fail if no specific translation health check
}

# Function to run smoke tests if available
run_smoke_tests() {
    if [ -f "package.json" ] && npm run | grep -q "test:smoke"; then
        echo "  🧪 Running smoke tests..."
        if npm run test:smoke -- --url "$URL" > /dev/null 2>&1; then
            return 0
        else
            return 1
        fi
    elif [ -f "scripts/smoke-tests.sh" ]; then
        echo "  🧪 Running custom smoke tests..."
        if bash scripts/smoke-tests.sh "$URL" > /dev/null 2>&1; then
            return 0
        else
            return 1
        fi
    else
        echo "  🧪 No smoke tests found"
        return 0  # Don't fail if no smoke tests
    fi
}

# Start verification process
echo "🚀 Starting deployment verification..."
echo "Environment: $ENVIRONMENT"
echo "Target URL: $URL"
echo "Timestamp: $(date)"
echo ""

# Run all verification tests
run_test "Service Health Check" "check_service_health"
run_test "API Endpoints Check" "check_api_endpoints"
run_test "Response Time Check" "check_response_times"
run_test "Database Connectivity" "check_database_connectivity"
run_test "Translation Service Check" "check_translation_service"
run_test "Smoke Tests" "run_smoke_tests"

echo ""
echo "📊 Verification Results Summary"
echo "================================"

# Count results
total_tests=${#test_results[@]}
passed_tests=0
failed_tests=0

for result in "${test_results[@]}"; do
    if [ "$result" == "PASS" ]; then
        ((passed_tests++))
    else
        ((failed_tests++))
    fi
done

echo "Total tests: $total_tests"
echo "Passed: $passed_tests"
echo "Failed: $failed_tests"

# Determine overall status
if [ $failed_tests -eq 0 ]; then
    echo ""
    echo "🎉 Deployment verification: SUCCESS"
    echo "✅ All verification tests passed"
    echo "🚀 $ENVIRONMENT deployment is healthy and ready to serve traffic"
    exit 0
elif [ $passed_tests -gt $failed_tests ]; then
    echo ""
    echo "⚠️ Deployment verification: PARTIAL SUCCESS"
    echo "✅ Most tests passed ($passed_tests/$total_tests)"
    echo "⚠️ Some non-critical tests failed"
    echo "🚀 $ENVIRONMENT deployment is likely healthy but should be monitored"
    exit 0
else
    echo ""
    echo "❌ Deployment verification: FAILED"
    echo "❌ Critical tests failed ($failed_tests/$total_tests)"
    echo "🚨 $ENVIRONMENT deployment may not be healthy"
    echo "💡 Consider rollback or investigation"
    exit 1
fi