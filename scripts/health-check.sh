#!/bin/bash
set -euo pipefail

# =============================================================================
# Universal Translator Pro - Health Check Script
# =============================================================================

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default values
ENVIRONMENT="production"
NAMESPACE="universal-translator-prod"
VERBOSE=false
OUTPUT_FORMAT="text"
TIMEOUT=30
MAX_RETRIES=3
CONTINUOUS=false
INTERVAL=60

# Health check endpoints
declare -A HEALTH_ENDPOINTS=(
    ["api"]="/health"
    ["api-ready"]="/ready"
    ["api-metrics"]="/metrics"
)

# Service ports
declare -A SERVICE_PORTS=(
    ["api"]="3001"
    ["api-health"]="8080"
    ["api-metrics"]="9090"
)

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] $*${NC}" >&2
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✓ $*${NC}" >&2
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ $*${NC}" >&2
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ✗ $*${NC}" >&2
}

usage() {
    cat << EOF
Usage: $0 [OPTIONS] [ENVIRONMENT]

Perform comprehensive health checks on Universal Translator Pro deployment.

ARGUMENTS:
    ENVIRONMENT                    Target environment (default: production)

OPTIONS:
    -v, --verbose                  Enable verbose output
    -f, --format FORMAT           Output format: text, json, prometheus (default: text)
    -t, --timeout SECONDS         Request timeout in seconds (default: 30)
    -r, --retries NUMBER          Maximum retry attempts (default: 3)
    -c, --continuous              Continuous monitoring mode
    -i, --interval SECONDS        Continuous check interval (default: 60)
    --port-forward                Use kubectl port-forward for checks
    --external-url URL            Use external URL instead of port-forward
    -h, --help                    Show this help message

EXAMPLES:
    $0                           # Basic health check for production
    $0 staging                   # Health check for staging environment
    $0 --verbose --format json   # Detailed health check with JSON output
    $0 --continuous              # Continuous monitoring
    $0 --external-url https://api.yourdomain.com

HEALTH CHECKS PERFORMED:
    - Service availability
    - Database connectivity
    - Redis connectivity
    - Translation services
    - API endpoints
    - Resource usage
    - Performance metrics

EOF
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT="$2"
                shift 2
                ;;
            -r|--retries)
                MAX_RETRIES="$2"
                shift 2
                ;;
            -c|--continuous)
                CONTINUOUS=true
                shift
                ;;
            -i|--interval)
                INTERVAL="$2"
                shift 2
                ;;
            --port-forward)
                USE_PORT_FORWARD=true
                shift
                ;;
            --external-url)
                EXTERNAL_URL="$2"
                shift 2
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
            *)
                ENVIRONMENT="$1"
                shift
                ;;
        esac
    done

    # Set namespace based on environment
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        NAMESPACE="universal-translator-staging"
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        NAMESPACE="universal-translator-prod"
    else
        log_error "Unsupported environment: $ENVIRONMENT"
        exit 1
    fi

    # Validate output format
    if [[ ! "$OUTPUT_FORMAT" =~ ^(text|json|prometheus)$ ]]; then
        log_error "Invalid output format: $OUTPUT_FORMAT"
        exit 1
    fi
}

# =============================================================================
# HEALTH CHECK FUNCTIONS
# =============================================================================

check_prerequisites() {
    local required_tools=("kubectl" "curl" "jq")
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "Required tool '$tool' is not installed"
            exit 1
        fi
    done

    # Check kubectl configuration
    if ! kubectl cluster-info &> /dev/null; then
        log_error "kubectl is not configured or cluster is not accessible"
        exit 1
    fi

    # Check namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_error "Namespace '$NAMESPACE' does not exist"
        exit 1
    fi
}

get_service_url() {
    local service="$1"
    local port="$2"
    local endpoint="${3:-}"
    
    if [[ -n "${EXTERNAL_URL:-}" ]]; then
        echo "${EXTERNAL_URL}${endpoint}"
    elif [[ "${USE_PORT_FORWARD:-false}" == "true" ]]; then
        echo "http://localhost:${port}${endpoint}"
    else
        # Try to get external IP or use port-forward
        local external_ip=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        
        if [[ -n "$external_ip" ]]; then
            echo "http://${external_ip}:${port}${endpoint}"
        else
            echo "http://localhost:${port}${endpoint}"
        fi
    fi
}

setup_port_forwards() {
    if [[ "${USE_PORT_FORWARD:-false}" == "true" || -z "${EXTERNAL_URL:-}" ]]; then
        log "Setting up port forwards..."
        
        # Port forward API service
        kubectl port-forward -n "$NAMESPACE" service/universal-translator-api 3001:3001 &
        kubectl port-forward -n "$NAMESPACE" service/universal-translator-api 8080:8080 &
        kubectl port-forward -n "$NAMESPACE" service/universal-translator-api 9090:9090 &
        
        # Store PIDs for cleanup
        echo $! > /tmp/health_check_port_forwards.pid
        
        # Wait for port forwards to be ready
        sleep 3
    fi
}

cleanup_port_forwards() {
    if [[ -f /tmp/health_check_port_forwards.pid ]]; then
        # Kill all port-forward processes
        pkill -f "kubectl port-forward" 2>/dev/null || true
        rm -f /tmp/health_check_port_forwards.pid
    fi
}

perform_http_check() {
    local name="$1"
    local url="$2"
    local expected_code="${3:-200}"
    local retries=0
    
    while [[ $retries -lt $MAX_RETRIES ]]; do
        if [[ "$VERBOSE" == "true" ]]; then
            log "Checking $name: $url (attempt $((retries + 1))/$MAX_RETRIES)"
        fi
        
        local response=$(curl -s -o /dev/null -w "%{http_code},%{time_total},%{size_download}" \
                        --max-time "$TIMEOUT" \
                        "$url" 2>/dev/null || echo "000,0,0")
        
        local http_code=$(echo "$response" | cut -d',' -f1)
        local time_total=$(echo "$response" | cut -d',' -f2)
        local size_download=$(echo "$response" | cut -d',' -f3)
        
        if [[ "$http_code" == "$expected_code" ]]; then
            if [[ "$VERBOSE" == "true" ]]; then
                log_success "$name check passed (${http_code}, ${time_total}s, ${size_download} bytes)"
            fi
            echo "1,$http_code,$time_total,$size_download"
            return 0
        fi
        
        retries=$((retries + 1))
        if [[ $retries -lt $MAX_RETRIES ]]; then
            sleep 2
        fi
    done
    
    log_error "$name check failed (HTTP $http_code after $MAX_RETRIES attempts)"
    echo "0,$http_code,$time_total,$size_download"
    return 1
}

check_kubernetes_resources() {
    log "Checking Kubernetes resources..."
    
    local deployments=("universal-translator-api")
    local overall_status=0
    local results=()
    
    for deployment in "${deployments[@]}"; do
        if kubectl get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
            local ready_replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
            local desired_replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
            
            if [[ "$ready_replicas" == "$desired_replicas" && "$ready_replicas" -gt 0 ]]; then
                if [[ "$VERBOSE" == "true" ]]; then
                    log_success "$deployment: $ready_replicas/$desired_replicas replicas ready"
                fi
                results+=("$deployment:1:$ready_replicas:$desired_replicas")
            else
                log_error "$deployment: $ready_replicas/$desired_replicas replicas ready"
                results+=("$deployment:0:$ready_replicas:$desired_replicas")
                overall_status=1
            fi
        else
            log_error "$deployment: deployment not found"
            results+=("$deployment:0:0:0")
            overall_status=1
        fi
    done
    
    echo "$overall_status:${results[*]}"
}

check_api_health() {
    log "Checking API health..."
    
    local api_url=$(get_service_url "universal-translator-api" "8080" "/health")
    local result=$(perform_http_check "API Health" "$api_url")
    
    echo "$result"
}

check_api_readiness() {
    log "Checking API readiness..."
    
    local api_url=$(get_service_url "universal-translator-api" "8080" "/ready")
    local result=$(perform_http_check "API Readiness" "$api_url")
    
    echo "$result"
}

check_api_metrics() {
    log "Checking API metrics..."
    
    local metrics_url=$(get_service_url "universal-translator-api" "9090" "/metrics")
    local result=$(perform_http_check "API Metrics" "$metrics_url")
    
    echo "$result"
}

check_database_connectivity() {
    log "Checking database connectivity..."
    
    # Check if PostgreSQL pods are running
    local postgres_pods=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=postgresql --no-headers 2>/dev/null | wc -l)
    
    if [[ "$postgres_pods" -gt 0 ]]; then
        local running_pods=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=postgresql --no-headers | grep -c "Running" || echo "0")
        
        if [[ "$running_pods" -eq "$postgres_pods" ]]; then
            if [[ "$VERBOSE" == "true" ]]; then
                log_success "Database pods running: $running_pods/$postgres_pods"
            fi
            echo "1:$running_pods:$postgres_pods"
        else
            log_error "Database pods not ready: $running_pods/$postgres_pods"
            echo "0:$running_pods:$postgres_pods"
        fi
    else
        log_error "No database pods found"
        echo "0:0:0"
    fi
}

check_redis_connectivity() {
    log "Checking Redis connectivity..."
    
    # Check if Redis pods are running
    local redis_pods=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=redis --no-headers 2>/dev/null | wc -l)
    
    if [[ "$redis_pods" -gt 0 ]]; then
        local running_pods=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=redis --no-headers | grep -c "Running" || echo "0")
        
        if [[ "$running_pods" -eq "$redis_pods" ]]; then
            if [[ "$VERBOSE" == "true" ]]; then
                log_success "Redis pods running: $running_pods/$redis_pods"
            fi
            echo "1:$running_pods:$redis_pods"
        else
            log_error "Redis pods not ready: $running_pods/$redis_pods"
            echo "0:$running_pods:$redis_pods"
        fi
    else
        log_error "No Redis pods found"
        echo "0:0:0"
    fi
}

check_translation_service() {
    log "Checking translation service..."
    
    local api_url=$(get_service_url "universal-translator-api" "3001" "/api/v1/health/translation")
    local result=$(perform_http_check "Translation Service" "$api_url")
    
    echo "$result"
}

# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

format_text_output() {
    local k8s_result="$1"
    local api_health_result="$2"
    local api_ready_result="$3"
    local api_metrics_result="$4"
    local db_result="$5"
    local redis_result="$6"
    local translation_result="$7"
    
    echo ""
    echo "============================================"
    echo "Universal Translator Pro Health Check"
    echo "============================================"
    echo "Environment: $ENVIRONMENT"
    echo "Namespace: $NAMESPACE"
    echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    # Parse results
    local k8s_status=$(echo "$k8s_result" | cut -d':' -f1)
    local api_health_status=$(echo "$api_health_result" | cut -d',' -f1)
    local api_ready_status=$(echo "$api_ready_result" | cut -d',' -f1)
    local api_metrics_status=$(echo "$api_metrics_result" | cut -d',' -f1)
    local db_status=$(echo "$db_result" | cut -d':' -f1)
    local redis_status=$(echo "$redis_result" | cut -d':' -f1)
    local translation_status=$(echo "$translation_result" | cut -d',' -f1)
    
    # Overall status
    local overall_status=$((k8s_status + api_health_status + api_ready_status + api_metrics_status + db_status + redis_status + translation_status))
    local max_checks=7
    
    echo "Overall Status: $([[ $overall_status -eq $max_checks ]] && echo "✅ HEALTHY" || echo "❌ UNHEALTHY")"
    echo "Checks Passed: $overall_status/$max_checks"
    echo ""
    
    # Individual check results
    echo "Component Status:"
    echo "=================="
    echo "Kubernetes Resources: $([[ $k8s_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "API Health Endpoint:  $([[ $api_health_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "API Ready Endpoint:   $([[ $api_ready_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "API Metrics:          $([[ $api_metrics_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "Database:             $([[ $db_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "Redis:                $([[ $redis_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo "Translation Service:  $([[ $translation_status -eq 1 ]] && echo "✅ OK" || echo "❌ FAIL")"
    echo ""
    
    # Return overall health status
    return $([[ $overall_status -eq $max_checks ]] && echo 0 || echo 1)
}

format_json_output() {
    local k8s_result="$1"
    local api_health_result="$2"
    local api_ready_result="$3"
    local api_metrics_result="$4"
    local db_result="$5"
    local redis_result="$6"
    local translation_result="$7"
    
    # Parse results
    local k8s_status=$(echo "$k8s_result" | cut -d':' -f1)
    local api_health_status=$(echo "$api_health_result" | cut -d',' -f1)
    local api_health_response_time=$(echo "$api_health_result" | cut -d',' -f3)
    local api_ready_status=$(echo "$api_ready_result" | cut -d',' -f1)
    local api_ready_response_time=$(echo "$api_ready_result" | cut -d',' -f3)
    local api_metrics_status=$(echo "$api_metrics_result" | cut -d',' -f1)
    local db_status=$(echo "$db_result" | cut -d':' -f1)
    local redis_status=$(echo "$redis_result" | cut -d':' -f1)
    local translation_status=$(echo "$translation_result" | cut -d',' -f1)
    local translation_response_time=$(echo "$translation_result" | cut -d',' -f3)
    
    local overall_healthy=$([[ $((k8s_status + api_health_status + api_ready_status + api_metrics_status + db_status + redis_status + translation_status)) -eq 7 ]] && echo "true" || echo "false")
    
    cat << EOF
{
    "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
    "environment": "$ENVIRONMENT",
    "namespace": "$NAMESPACE",
    "overall_healthy": $overall_healthy,
    "checks": {
        "kubernetes": {
            "healthy": $([[ $k8s_status -eq 1 ]] && echo "true" || echo "false")
        },
        "api_health": {
            "healthy": $([[ $api_health_status -eq 1 ]] && echo "true" || echo "false"),
            "response_time": $api_health_response_time
        },
        "api_ready": {
            "healthy": $([[ $api_ready_status -eq 1 ]] && echo "true" || echo "false"),
            "response_time": $api_ready_response_time
        },
        "api_metrics": {
            "healthy": $([[ $api_metrics_status -eq 1 ]] && echo "true" || echo "false")
        },
        "database": {
            "healthy": $([[ $db_status -eq 1 ]] && echo "true" || echo "false")
        },
        "redis": {
            "healthy": $([[ $redis_status -eq 1 ]] && echo "true" || echo "false")
        },
        "translation_service": {
            "healthy": $([[ $translation_status -eq 1 ]] && echo "true" || echo "false"),
            "response_time": $translation_response_time
        }
    }
}
EOF
}

# =============================================================================
# MAIN HEALTH CHECK WORKFLOW
# =============================================================================

run_health_checks() {
    # Set up port forwards if needed
    setup_port_forwards
    
    # Run all health checks
    local k8s_result=$(check_kubernetes_resources)
    local api_health_result=$(check_api_health)
    local api_ready_result=$(check_api_readiness)
    local api_metrics_result=$(check_api_metrics)
    local db_result=$(check_database_connectivity)
    local redis_result=$(check_redis_connectivity)
    local translation_result=$(check_translation_service)
    
    # Format output
    case "$OUTPUT_FORMAT" in
        "text")
            format_text_output "$k8s_result" "$api_health_result" "$api_ready_result" "$api_metrics_result" "$db_result" "$redis_result" "$translation_result"
            local exit_code=$?
            ;;
        "json")
            format_json_output "$k8s_result" "$api_health_result" "$api_ready_result" "$api_metrics_result" "$db_result" "$redis_result" "$translation_result"
            local exit_code=$([[ $(echo "$k8s_result $api_health_result $api_ready_result $api_metrics_result $db_result $redis_result $translation_result" | grep -c "^1\|,1,") -eq 7 ]] && echo 0 || echo 1)
            ;;
        "prometheus")
            # TODO: Implement Prometheus format
            log_error "Prometheus format not yet implemented"
            local exit_code=1
            ;;
    esac
    
    # Cleanup
    cleanup_port_forwards
    
    return $exit_code
}

continuous_monitoring() {
    log "Starting continuous monitoring (interval: ${INTERVAL}s)"
    log "Press Ctrl+C to stop"
    
    while true; do
        run_health_checks
        sleep "$INTERVAL"
        echo ""
    done
}

# =============================================================================
# CLEANUP FUNCTION
# =============================================================================

cleanup() {
    cleanup_port_forwards
}

# =============================================================================
# MAIN FUNCTION
# =============================================================================

main() {
    parse_args "$@"
    
    trap cleanup EXIT
    
    check_prerequisites
    
    if [[ "$CONTINUOUS" == "true" ]]; then
        continuous_monitoring
    else
        run_health_checks
    fi
}

# =============================================================================
# SCRIPT EXECUTION
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi