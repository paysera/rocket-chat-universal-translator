#!/bin/bash

URL=$1
MAX_RETRIES=30
RETRY_INTERVAL=10
TIMEOUT=5

if [ -z "$URL" ]; then
    echo "Usage: $0 <URL>"
    echo "Example: $0 https://api.example.com"
    exit 1
fi

echo "🏥 Running comprehensive health checks on $URL..."

# Function to check HTTP status
check_http_status() {
    local url=$1
    local expected_status=${2:-200}

    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$url" 2>/dev/null)

    if [ "$STATUS" == "$expected_status" ]; then
        return 0
    else
        return 1
    fi
}

# Function to check response time
check_response_time() {
    local url=$1
    local max_time=${2:-2000}  # 2 seconds in milliseconds

    RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time $TIMEOUT "$url" 2>/dev/null)

    # Convert to milliseconds
    RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc -l 2>/dev/null || echo "0")
    RESPONSE_TIME_MS=${RESPONSE_TIME_MS%.*}  # Remove decimal part

    if [ "$RESPONSE_TIME_MS" -lt "$max_time" ] && [ "$RESPONSE_TIME_MS" -gt 0 ]; then
        echo "✅ Response time: ${RESPONSE_TIME_MS}ms (acceptable)"
        return 0
    else
        echo "⚠️ Response time: ${RESPONSE_TIME_MS}ms (slow or failed)"
        return 1
    fi
}

# Function to check specific endpoint
check_endpoint() {
    local endpoint=$1
    local description=$2
    local expected_status=${3:-200}

    echo "  Checking $description..."

    if check_http_status "$URL$endpoint" "$expected_status"; then
        echo "    ✅ $description: OK (HTTP $expected_status)"
        return 0
    else
        STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$URL$endpoint" 2>/dev/null)
        echo "    ❌ $description: FAILED (HTTP $STATUS)"
        return 1
    fi
}

# Start health check process
echo "🔍 Starting health check process..."
echo "Target URL: $URL"
echo "Max retries: $MAX_RETRIES"
echo "Retry interval: ${RETRY_INTERVAL}s"
echo ""

OVERALL_SUCCESS=true

for i in $(seq 1 $MAX_RETRIES); do
    echo "📋 Health Check Attempt $i/$MAX_RETRIES"
    echo "$(date): Starting health check round $i"

    ROUND_SUCCESS=true

    # Basic connectivity check
    echo "🔗 Basic connectivity check..."
    if check_http_status "$URL" || check_http_status "$URL/" ; then
        echo "  ✅ Basic connectivity: OK"
    else
        echo "  ❌ Basic connectivity: FAILED"
        ROUND_SUCCESS=false
    fi

    # Health endpoint check
    echo "🏥 Health endpoint checks..."
    check_endpoint "/health" "Health endpoint" 200 || ROUND_SUCCESS=false
    check_endpoint "/healthz" "Healthz endpoint" 200 || check_endpoint "/ping" "Ping endpoint" 200 || echo "  ⚠️ No standard health endpoint found"

    # API readiness check
    echo "🔌 API readiness checks..."
    check_endpoint "/api" "API root" 200 || check_endpoint "/api/health" "API health" 200 || echo "  ⚠️ No API health endpoint found"

    # Version/info endpoint check
    echo "ℹ️ Information endpoints..."
    check_endpoint "/version" "Version endpoint" 200 || check_endpoint "/info" "Info endpoint" 200 || echo "  ⚠️ No version endpoint found"

    # Performance check
    echo "⚡ Performance check..."
    check_response_time "$URL"

    # Check if all tests in this round passed
    if [ "$ROUND_SUCCESS" = true ]; then
        echo ""
        echo "🎉 All health checks passed on attempt $i!"
        echo "$(date): Health check successful"
        echo ""
        echo "📊 Final Health Check Summary:"
        echo "  Status: ✅ HEALTHY"
        echo "  Attempts needed: $i"
        echo "  URL: $URL"
        echo "  Timestamp: $(date)"
        exit 0
    else
        echo ""
        echo "❌ Health check failed on attempt $i"

        if [ $i -eq $MAX_RETRIES ]; then
            echo ""
            echo "💀 All $MAX_RETRIES health check attempts failed!"
            echo "$(date): Final health check failure"
            echo ""
            echo "📊 Final Health Check Summary:"
            echo "  Status: ❌ UNHEALTHY"
            echo "  Attempts made: $MAX_RETRIES"
            echo "  URL: $URL"
            echo "  Timestamp: $(date)"
            echo ""
            echo "🔍 Debugging information:"
            echo "  Last HTTP status: $(curl -s -o /dev/null -w '%{http_code}' --max-time $TIMEOUT "$URL" 2>/dev/null || echo 'Connection failed')"
            echo "  DNS resolution: $(nslookup $(echo "$URL" | sed 's|https\?://||' | cut -d'/' -f1) 2>/dev/null | grep -A1 'Name:' || echo 'DNS lookup failed')"

            OVERALL_SUCCESS=false
            break
        else
            echo "  ⏳ Waiting ${RETRY_INTERVAL}s before next attempt..."
            sleep $RETRY_INTERVAL
        fi
    fi
    echo ""
done

if [ "$OVERALL_SUCCESS" = false ]; then
    exit 1
fi