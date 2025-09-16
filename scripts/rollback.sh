#!/bin/bash
set -euo pipefail

# =============================================================================
# Universal Translator Pro - Production Rollback Script
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
readonly TIMEOUT_SECONDS=600

# Default values
ENVIRONMENT="production"
NAMESPACE="universal-translator-prod"
ROLLBACK_TO=""
DRY_RUN=false
AUTO_CONFIRM=false
SLACK_WEBHOOK=""

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

Rollback Universal Translator Pro deployment to previous version.

ARGUMENTS:
    ENVIRONMENT                    Target environment (default: production)

OPTIONS:
    -t, --rollback-to VERSION     Specific version to rollback to
    -d, --dry-run                 Perform a dry run without making changes
    -y, --yes                     Auto-confirm rollback without prompts
    --slack-webhook URL           Slack webhook URL for notifications
    -h, --help                    Show this help message

EXAMPLES:
    $0                           # Rollback production to previous revision
    $0 staging                   # Rollback staging environment
    $0 --rollback-to v1.2.1     # Rollback to specific version
    $0 --dry-run                 # Preview rollback actions

NOTES:
    - Without --rollback-to, rolls back to the previous revision
    - Requires kubectl access to the target cluster
    - Creates a backup before rollback
    - Performs health checks after rollback

EOF
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -t|--rollback-to)
                ROLLBACK_TO="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -y|--yes)
                AUTO_CONFIRM=true
                shift
                ;;
            --slack-webhook)
                SLACK_WEBHOOK="$2"
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
}

# =============================================================================
# PREREQUISITE CHECKS
# =============================================================================

check_prerequisites() {
    log "Checking prerequisites..."

    # Check required tools
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

    log_success "Prerequisites check passed"
}

# =============================================================================
# ROLLBACK FUNCTIONS
# =============================================================================

get_current_deployment_info() {
    log "Getting current deployment information..."

    local deployments=("universal-translator-api")
    
    echo "Current deployment status:"
    echo "========================="
    
    for deployment in "${deployments[@]}"; do
        if kubectl get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
            echo ""
            echo "Deployment: $deployment"
            echo "Namespace: $NAMESPACE"
            
            # Get current image
            local current_image=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}')
            echo "Current Image: $current_image"
            
            # Get rollout history
            echo "Rollout History:"
            kubectl rollout history deployment/"$deployment" -n "$NAMESPACE" | tail -5
            
            # Get replica status
            local replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}/{.spec.replicas}')
            echo "Ready Replicas: $replicas"
        else
            log_warning "Deployment $deployment not found in namespace $NAMESPACE"
        fi
    done
    
    echo ""
}

confirm_rollback() {
    if [[ "$AUTO_CONFIRM" == "true" ]]; then
        return 0
    fi

    echo ""
    echo "⚠️  WARNING: You are about to rollback the $ENVIRONMENT environment!"
    echo ""
    echo "This action will:"
    echo "  - Rollback all services to a previous version"
    echo "  - Potentially cause brief service interruption"
    echo "  - Create a backup of current state"
    echo ""
    
    if [[ -n "$ROLLBACK_TO" ]]; then
        echo "  Target version: $ROLLBACK_TO"
    else
        echo "  Target: Previous revision"
    fi
    
    echo ""
    read -p "Are you sure you want to proceed? (type 'yes' to confirm): " -r
    echo ""
    
    if [[ ! "$REPLY" == "yes" ]]; then
        log "Rollback cancelled by user"
        exit 0
    fi
}

create_pre_rollback_backup() {
    log "Creating pre-rollback backup..."

    local backup_timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="pre-rollback-${backup_timestamp}"

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would create backup: $backup_name"
        return 0
    fi

    if [[ -f "$PROJECT_ROOT/scripts/backup.sh" ]]; then
        if "$PROJECT_ROOT/scripts/backup.sh" "$backup_name"; then
            log_success "Backup created: $backup_name"
            echo "$backup_name" > /tmp/rollback_backup_name
        else
            log_error "Backup creation failed"
            return 1
        fi
    else
        log_warning "Backup script not found, skipping backup"
    fi
}

perform_rollback() {
    log "Performing rollback..."

    local deployments=("universal-translator-api")
    
    for deployment in "${deployments[@]}"; do
        if ! kubectl get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
            log_warning "Deployment $deployment not found, skipping"
            continue
        fi
        
        log "Rolling back deployment: $deployment"
        
        if [[ "$DRY_RUN" == "true" ]]; then
            log "DRY RUN: Would rollback $deployment"
            if [[ -n "$ROLLBACK_TO" ]]; then
                log "DRY RUN: Target version: $ROLLBACK_TO"
            else
                log "DRY RUN: Target: Previous revision"
            fi
            continue
        fi

        if [[ -n "$ROLLBACK_TO" ]]; then
            # Rollback to specific version
            local image_name="ghcr.io/your-org/universal-translator/${deployment#universal-translator-}:$ROLLBACK_TO"
            
            if ! kubectl set image deployment/"$deployment" \
                "${deployment#universal-translator-}=$image_name" \
                -n "$NAMESPACE"; then
                log_error "Failed to set image for $deployment"
                return 1
            fi
        else
            # Rollback to previous revision
            if ! kubectl rollout undo deployment/"$deployment" -n "$NAMESPACE"; then
                log_error "Failed to rollback $deployment"
                return 1
            fi
        fi
        
        log "Waiting for $deployment rollback to complete..."
        if ! kubectl rollout status deployment/"$deployment" \
             -n "$NAMESPACE" \
             --timeout="${TIMEOUT_SECONDS}s"; then
            log_error "Rollback timeout for $deployment"
            return 1
        fi
        
        log_success "Rollback completed for $deployment"
    done
}

# =============================================================================
# POST-ROLLBACK CHECKS
# =============================================================================

run_health_checks() {
    log "Running post-rollback health checks..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would run health checks"
        return 0
    fi

    local health_check_retries=5
    local health_check_interval=30
    local retries=0

    # Port forward for health check
    kubectl port-forward -n "$NAMESPACE" service/universal-translator-api 8080:8080 &
    local port_forward_pid=$!
    sleep 5

    while [[ $retries -lt $health_check_retries ]]; do
        log "Health check attempt $((retries + 1))/$health_check_retries"
        
        if curl -sf "http://localhost:8080/health" > /dev/null; then
            log_success "Health check passed"
            kill $port_forward_pid 2>/dev/null || true
            return 0
        fi

        retries=$((retries + 1))
        if [[ $retries -lt $health_check_retries ]]; then
            sleep $health_check_interval
        fi
    done

    kill $port_forward_pid 2>/dev/null || true
    log_error "Health checks failed after $health_check_retries attempts"
    return 1
}

verify_rollback() {
    log "Verifying rollback..."

    local deployments=("universal-translator-api")
    
    echo ""
    echo "Post-rollback deployment status:"
    echo "==============================="
    
    for deployment in "${deployments[@]}"; do
        if kubectl get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
            echo ""
            echo "Deployment: $deployment"
            
            # Get current image
            local current_image=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}')
            echo "Current Image: $current_image"
            
            # Get replica status
            local replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}/{.spec.replicas}')
            echo "Ready Replicas: $replicas"
            
            # Check if all replicas are ready
            local ready_replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}')
            local desired_replicas=$(kubectl get deployment "$deployment" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
            
            if [[ "$ready_replicas" == "$desired_replicas" ]]; then
                echo "Status: ✅ Healthy"
            else
                echo "Status: ❌ Not all replicas ready"
            fi
        fi
    done
    
    echo ""
}

# =============================================================================
# NOTIFICATION FUNCTION
# =============================================================================

send_slack_notification() {
    local status="$1"
    local message="$2"

    if [[ -z "$SLACK_WEBHOOK" ]]; then
        return 0
    fi

    local color
    case "$status" in
        "success") color="good" ;;
        "warning") color="warning" ;;
        "error") color="danger" ;;
        *) color="warning" ;;
    esac

    local target
    if [[ -n "$ROLLBACK_TO" ]]; then
        target="$ROLLBACK_TO"
    else
        target="previous revision"
    fi

    local payload=$(cat << EOF
{
    "attachments": [
        {
            "color": "$color",
            "title": "Universal Translator Pro Rollback",
            "text": "$message",
            "fields": [
                {
                    "title": "Environment",
                    "value": "$ENVIRONMENT",
                    "short": true
                },
                {
                    "title": "Rollback Target",
                    "value": "$target",
                    "short": true
                },
                {
                    "title": "Timestamp",
                    "value": "$(date '+%Y-%m-%d %H:%M:%S')",
                    "short": true
                }
            ]
        }
    ]
}
EOF
)

    curl -X POST \
         -H 'Content-Type: application/json' \
         -d "$payload" \
         "$SLACK_WEBHOOK" &> /dev/null || true
}

# =============================================================================
# CLEANUP FUNCTION
# =============================================================================

cleanup() {
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "Rollback failed with exit code $exit_code"
        send_slack_notification "error" "Rollback failed! Manual intervention required."
    else
        log_success "Rollback completed successfully"
        send_slack_notification "success" "Rollback completed successfully!"
    fi
    
    # Cleanup any temporary files
    rm -f /tmp/rollback_backup_name
    
    exit $exit_code
}

# =============================================================================
# MAIN ROLLBACK WORKFLOW
# =============================================================================

main() {
    parse_args "$@"
    
    log "Starting rollback for $ENVIRONMENT environment"
    if [[ -n "$ROLLBACK_TO" ]]; then
        log "Target version: $ROLLBACK_TO"
    else
        log "Target: Previous revision"
    fi
    log "Dry run: $DRY_RUN"
    
    trap cleanup EXIT
    
    # Prerequisites
    check_prerequisites
    
    # Show current state
    get_current_deployment_info
    
    # Confirm rollback
    confirm_rollback
    
    # Perform rollback
    create_pre_rollback_backup
    perform_rollback
    
    # Verify rollback
    run_health_checks
    verify_rollback
    
    log_success "Rollback completed successfully!"
}

# =============================================================================
# SCRIPT EXECUTION
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi