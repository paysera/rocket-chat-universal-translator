#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

echo -e "${BLUE}📊 Performance Test Results Analysis${NC}"
echo "===================================="

# Create results directory if it doesn't exist
mkdir -p performance-results
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Function to extract metrics from k6 JSON output
extract_k6_metrics() {
    local test_name=$1
    local json_file=$2

    if [ ! -f "$json_file" ]; then
        echo -e "${YELLOW}⚠️  JSON results file not found: $json_file${NC}"
        return 1
    fi

    echo -e "${PURPLE}📈 $test_name Metrics:${NC}"

    # Extract key metrics using jq if available, otherwise use grep/awk
    if command -v jq &> /dev/null; then
        local http_req_duration_p95=$(jq -r '.metrics.http_req_duration.values.p95' "$json_file" 2>/dev/null)
        local http_req_failed_rate=$(jq -r '.metrics.http_req_failed.values.rate' "$json_file" 2>/dev/null)
        local http_reqs_total=$(jq -r '.metrics.http_reqs.values.count' "$json_file" 2>/dev/null)
        local vus_max=$(jq -r '.metrics.vus_max.values.max' "$json_file" 2>/dev/null)

        echo "  • P95 Response Time: ${http_req_duration_p95:-'N/A'}ms"
        echo "  • Error Rate: $(echo "scale=2; ${http_req_failed_rate:-0} * 100" | bc 2>/dev/null || echo "${http_req_failed_rate:-0}")%"
        echo "  • Total Requests: ${http_reqs_total:-'N/A'}"
        echo "  • Max Virtual Users: ${vus_max:-'N/A'}"
    else
        echo "  • JSON analysis requires 'jq' tool (install with: brew install jq)"
        echo "  • Check the JSON file manually: $json_file"
    fi
}

# Function to analyze HTML report
analyze_html_report() {
    local html_file=$1

    if [ ! -f "$html_file" ]; then
        echo -e "${YELLOW}⚠️  HTML report not found: $html_file${NC}"
        return 1
    fi

    echo -e "${GREEN}✅ HTML Report generated: $html_file${NC}"
    echo "  • Open in browser to view detailed graphs and metrics"
    echo "  • Look for response time trends and error patterns"
    echo "  • Check if thresholds were met (green) or failed (red)"
}

# Function to check if thresholds were met
check_thresholds() {
    local test_output=$1

    echo -e "${PURPLE}🎯 Threshold Analysis:${NC}"

    if echo "$test_output" | grep -q "✓.*http_req_duration.*p(95)<500"; then
        echo -e "  ${GREEN}✅ P95 Response Time: < 500ms (PASSED)${NC}"
    elif echo "$test_output" | grep -q "✗.*http_req_duration.*p(95)<500"; then
        echo -e "  ${RED}❌ P95 Response Time: >= 500ms (FAILED)${NC}"
    else
        echo -e "  ${YELLOW}⚠️  P95 Response Time: Status unknown${NC}"
    fi

    if echo "$test_output" | grep -q "✓.*http_req_failed.*rate<0.1"; then
        echo -e "  ${GREEN}✅ Error Rate: < 10% (PASSED)${NC}"
    elif echo "$test_output" | grep -q "✗.*http_req_failed.*rate<0.1"; then
        echo -e "  ${RED}❌ Error Rate: >= 10% (FAILED)${NC}"
    else
        echo -e "  ${YELLOW}⚠️  Error Rate: Status unknown${NC}"
    fi
}

# Main analysis function
main_analysis() {
    echo -e "${BLUE}🔍 Analyzing Performance Test Results...${NC}"
    echo ""

    # Look for recent test result files
    local results_found=0

    # Check for API load test results
    if [ -f "api-load-test-results.json" ]; then
        extract_k6_metrics "API Load Test" "api-load-test-results.json"
        results_found=1
        echo ""
    fi

    if [ -f "performance-report.html" ]; then
        analyze_html_report "performance-report.html"
        results_found=1
        echo ""
    fi

    # Check for Rocket.Chat test results
    if [ -f "rocketchat-load-test-results.json" ]; then
        extract_k6_metrics "Rocket.Chat Load Test" "rocketchat-load-test-results.json"
        results_found=1
        echo ""
    fi

    # Check for memory leak test results
    if [ -f "memory-leak-test-results.json" ]; then
        extract_k6_metrics "Memory Leak Test" "memory-leak-test-results.json"
        results_found=1
        echo ""
    fi

    # Check for database performance results
    if [ -d "performance-results" ] && [ "$(ls -A performance-results 2>/dev/null)" ]; then
        echo -e "${PURPLE}🗄️  Database Performance Results:${NC}"
        find performance-results -name "*results*.txt" -o -name "*results*.csv" | head -5 | while read -r file; do
            echo "  • $(basename "$file")"
        done
        results_found=1
        echo ""
    fi

    if [ $results_found -eq 0 ]; then
        echo -e "${YELLOW}⚠️  No performance test results found in current directory${NC}"
        echo "Run tests first with:"
        echo "  k6 run --out json=api-load-test-results.json api-load-test.js"
        echo "  k6 run --out html=performance-report.html api-load-test.js"
        echo ""
    fi
}

# Performance recommendations
generate_recommendations() {
    echo -e "${BLUE}📝 Performance Optimization Recommendations${NC}"
    echo "============================================"

    cat << EOF

🚀 IMMEDIATE OPTIMIZATIONS:
1. Enable Response Caching
   - Implement Redis caching for frequent translations
   - Cache language detection results
   - Set appropriate TTL (Time To Live) values

2. Database Query Optimization
   - Add indexes on frequently queried columns
   - Monitor slow query logs
   - Consider connection pooling

3. API Rate Limiting
   - Implement per-user rate limiting
   - Use sliding window rate limiting
   - Add circuit breakers for external services

⚡ PERFORMANCE TUNING:
4. Memory Management
   - Monitor heap usage and garbage collection
   - Implement request timeout limits
   - Set maximum request payload sizes

5. Connection Optimization
   - Configure appropriate connection pool sizes
   - Enable HTTP/2 if supported
   - Implement connection keep-alive

6. Caching Strategy
   - Cache translation results by text hash
   - Implement cache warming for popular content
   - Use CDN for static assets

🔧 INFRASTRUCTURE SCALING:
7. Horizontal Scaling
   - Add load balancer for multiple API instances
   - Implement session-less architecture
   - Consider microservices separation

8. Database Scaling
   - Read replicas for read-heavy workloads
   - Database sharding for high-volume data
   - MongoDB replica sets for Rocket.Chat

9. Monitoring & Alerting
   - Set up performance monitoring dashboards
   - Create alerts for high response times
   - Monitor error rates and availability

📊 PERFORMANCE TARGETS:
- P95 Response Time: < 500ms
- Error Rate: < 10%
- Concurrent Users: 100+
- Memory Usage: Stable (no leaks)
- Database Queries: < 100ms average

🛠️ TOOLS FOR MONITORING:
- Grafana dashboards for metrics visualization
- Prometheus for metrics collection
- New Relic or DataDog for APM
- Database-specific monitoring tools

EOF
}

# System resource analysis
analyze_system_resources() {
    echo -e "${PURPLE}🖥️  System Resource Analysis${NC}"
    echo "=============================="

    if command -v docker &> /dev/null; then
        echo "Docker Container Resources:"
        docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -10
        echo ""
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macOS System Resources:"
        echo "  • CPU Usage: $(top -l 1 -n 0 | grep "CPU usage" | awk '{print $3}' | sed 's/,//')"
        echo "  • Memory Pressure: $(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}' 2>/dev/null || echo "N/A")"
        echo "  • Available Memory: $(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//' | awk '{print ($1 * 4096) / 1024 / 1024 " MB"}' 2>/dev/null || echo "N/A")"
    fi

    echo ""
}

# Generate comprehensive report
generate_report() {
    local report_file="performance-analysis-report-$TIMESTAMP.md"

    cat > "$report_file" << EOF
# Performance Test Analysis Report

**Generated**: $(date)
**Test Environment**: Development (http://192.168.110.199:3012)

## Test Results Summary

### Load Test Performance
- **Target**: 100 concurrent users
- **Duration**: 16 minutes (ramp up + sustained + ramp down)
- **P95 Response Time Target**: < 500ms
- **Error Rate Target**: < 10%

### Memory Leak Detection
- **Duration**: 15 minutes sustained load
- **Memory Growth Monitoring**: Enabled
- **Leak Detection**: Automated analysis

### Database Performance
- **PostgreSQL**: Query execution analysis
- **Redis**: Operations per second benchmarking
- **MongoDB**: Document operations and indexing

## Key Findings

$(if [ -f "api-load-test-results.json" ]; then
    echo "### API Load Test Results"
    echo "- Results file: api-load-test-results.json"
    echo "- Check JSON file for detailed metrics"
    echo ""
fi)

$(if [ -f "performance-report.html" ]; then
    echo "### Visual Report"
    echo "- HTML report available: performance-report.html"
    echo "- Open in browser for detailed graphs and trends"
    echo ""
fi)

## Optimization Recommendations

1. **Immediate Actions**
   - Review failed thresholds and identify bottlenecks
   - Implement caching for frequent operations
   - Optimize database queries and indexing

2. **Medium-term Improvements**
   - Scale infrastructure based on load test results
   - Implement comprehensive monitoring
   - Set up automated performance regression testing

3. **Long-term Strategy**
   - Plan for horizontal scaling architecture
   - Implement advanced caching strategies
   - Consider microservices separation for better scalability

## Next Steps

- [ ] Review detailed test results
- [ ] Implement high-priority optimizations
- [ ] Set up continuous performance monitoring
- [ ] Schedule regular performance testing
- [ ] Create performance benchmarks for regression testing

---

*Generated by performance analysis script*
EOF

    echo -e "${GREEN}✅ Comprehensive report generated: $report_file${NC}"
}

# Main execution
main() {
    main_analysis
    analyze_system_resources
    generate_recommendations
    generate_report

    echo -e "${GREEN}🎉 Performance Analysis Complete!${NC}"
    echo ""
    echo -e "${BLUE}📋 Summary of Analysis Files:${NC}"
    echo "  • Comprehensive report: performance-analysis-report-$TIMESTAMP.md"

    if [ -f "performance-report.html" ]; then
        echo "  • Visual report: performance-report.html"
    fi

    if [ -d "performance-results" ] && [ "$(ls -A performance-results 2>/dev/null)" ]; then
        echo "  • Database results: performance-results/ directory"
    fi

    echo ""
    echo -e "${YELLOW}📚 Next Steps:${NC}"
    echo "1. Review the detailed analysis report"
    echo "2. Open HTML report in browser for visual analysis"
    echo "3. Implement recommended optimizations"
    echo "4. Set up continuous performance monitoring"
    echo "5. Schedule regular performance testing"
}

# Check if running with specific analysis mode
case "${1:-main}" in
    "json")
        if [ -n "$2" ]; then
            extract_k6_metrics "Custom Analysis" "$2"
        else
            echo "Usage: $0 json <json-file>"
        fi
        ;;
    "html")
        if [ -n "$2" ]; then
            analyze_html_report "$2"
        else
            echo "Usage: $0 html <html-file>"
        fi
        ;;
    "recommendations")
        generate_recommendations
        ;;
    "report")
        generate_report
        ;;
    *)
        main
        ;;
esac