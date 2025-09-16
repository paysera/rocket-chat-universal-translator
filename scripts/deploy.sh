#!/bin/bash
set -euo pipefail

# =============================================================================
# Universal Translator Pro - Production Deployment Script
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
readonly NAMESPACE="universal-translator-prod"
readonly TIMEOUT_SECONDS=900
readonly HEALTH_CHECK_RETRIES=10
readonly HEALTH_CHECK_INTERVAL=30

# Default values
ENVIRONMENT="production"
DRY_RUN=false
SKIP_TESTS=false
FORCE_DEPLOY=false
VERSION=""
SLACK_WEBHOOK=""
ROLLBACK_ON_FAILURE=true

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
Usage: $0 [OPTIONS]

Deploy Universal Translator Pro to production environment.

OPTIONS:
    -e, --environment ENVIRONMENT    Target environment (default: production)
    -v, --version VERSION           Version to deploy (required for production)
    -d, --dry-run                   Perform a dry run without making changes
    -s, --skip-tests               Skip pre-deployment tests
    -f, --force                    Force deployment even if health checks fail
    --no-rollback                  Don't rollback on failure
    --slack-webhook URL            Slack webhook URL for notifications
    -h, --help                     Show this help message

EXAMPLES:
    $0 --version v1.2.3
    $0 --version v1.2.3 --dry-run
    $0 --environment staging --version latest
    $0 --version v1.2.3 --slack-webhook https://hooks.slack.com/...

EOF
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -s|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -f|--force)
                FORCE_DEPLOY=true
                shift
                ;;
            --no-rollback)
                ROLLBACK_ON_FAILURE=false
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
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Validate required parameters
    if [[ "$ENVIRONMENT" == "production" && -z "$VERSION" ]]; then
        log_error "Version is required for production deployments"
        exit 1
    fi

    if [[ -z "$VERSION" ]]; then
        VERSION="latest"
    fi
}

# =============================================================================
# PREREQUISITE CHECKS
# =============================================================================

check_prerequisites() {
    log "Checking prerequisites..."

    # Check required tools
    local required_tools=("kubectl" "kustomize" "docker" "curl" "jq")
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

    # Check if running from correct directory
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        log_error "Must be run from the project root directory"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# =============================================================================
# PRE-DEPLOYMENT FUNCTIONS
# =============================================================================

run_pre_deployment_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_warning "Skipping pre-deployment tests"
        return 0
    fi

    log "Running pre-deployment tests..."

    # Run unit tests
    if ! npm test -- --watchAll=false; then
        log_error "Unit tests failed"
        return 1
    fi

    # Run integration tests
    if [[ -f "$PROJECT_ROOT/scripts/integration-tests.sh" ]]; then
        if ! "$PROJECT_ROOT/scripts/integration-tests.sh"; then
            log_error "Integration tests failed"
            return 1
        fi
    fi

    log_success "Pre-deployment tests passed"
}

create_backup() {
    log "Creating pre-deployment backup..."

    local backup_timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="pre-deploy-${backup_timestamp}"

    if [[ -f "$PROJECT_ROOT/scripts/backup.sh" ]]; then
        if "$PROJECT_ROOT/scripts/backup.sh" "$backup_name"; then
            log_success "Backup created: $backup_name"
            echo "$backup_name" > /tmp/deployment_backup_name
        else
            log_error "Backup creation failed"
            return 1
        fi
    else
        log_warning "Backup script not found, skipping backup"
    fi
}

# =============================================================================
# DEPLOYMENT FUNCTIONS
# =============================================================================

update_image_tags() {
    log "Updating image tags to version: $VERSION"

    cd "$PROJECT_ROOT/k8s/overlays/$ENVIRONMENT"

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would update image tags to $VERSION"
        return 0
    fi

    # Update API image
    kustomize edit set image "universal-translator/api=ghcr.io/your-org/universal-translator/api:$VERSION"

    # Update Plugin image (if exists)
    if grep -q "universal-translator/plugin" kustomization.yaml; then
        kustomize edit set image "universal-translator/plugin=ghcr.io/your-org/universal-translator/plugin:$VERSION"
    fi

    log_success "Image tags updated"
}

apply_manifests() {
    log "Applying Kubernetes manifests..."

    cd "$PROJECT_ROOT/k8s/overlays/$ENVIRONMENT"

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would apply the following manifests:"
        kustomize build . | kubectl apply --dry-run=client -f -
        return 0
    fi

    # Apply manifests
    if ! kustomize build . | kubectl apply -f -; then
        log_error "Failed to apply manifests"
        return 1
    fi

    log_success "Manifests applied successfully"
}

wait_for_rollout() {
    log "Waiting for deployment rollout..."

    local deployments=("universal-translator-api")
    
    for deployment in "${deployments[@]}"; do
        log "Waiting for $deployment rollout..."
        
        if [[ "$DRY_RUN" == "true" ]]; then
            log "DRY RUN: Would wait for $deployment rollout"
            continue
        fi

        if ! kubectl rollout status "deployment/$deployment" \
             -n "$NAMESPACE" \
             --timeout="${TIMEOUT_SECONDS}s"; then
            log_error "Rollout failed for $deployment"
            return 1
        fi
    done

    log_success "All deployments rolled out successfully"
}

# =============================================================================
# HEALTH CHECKS
# =============================================================================

run_health_checks() {
    log "Running health checks..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would run health checks"
        return 0
    fi

    local health_check_url
    local retries=0

    # Get service URL
    if kubectl get service universal-translator-api -n "$NAMESPACE" &> /dev/null; then
        # Port forward for health check
        kubectl port-forward -n "$NAMESPACE" service/universal-translator-api 8080:8080 &
        local port_forward_pid=$!
        sleep 5
        health_check_url="http://localhost:8080/health"
    else
        log_error "Service universal-translator-api not found"
        return 1
    fi

    # Perform health checks
    while [[ $retries -lt $HEALTH_CHECK_RETRIES ]]; do
        log "Health check attempt $((retries + 1))/$HEALTH_CHECK_RETRIES"
        
        if curl -sf "$health_check_url" > /dev/null; then
            log_success "Health check passed"
            kill $port_forward_pid 2>/dev/null || true
            return 0
        fi

        retries=$((retries + 1))
        if [[ $retries -lt $HEALTH_CHECK_RETRIES ]]; then
            sleep $HEALTH_CHECK_INTERVAL
        fi
    done

    kill $port_forward_pid 2>/dev/null || true
    log_error "Health checks failed after $HEALTH_CHECK_RETRIES attempts"
    return 1
}

run_smoke_tests() {
    log "Running smoke tests..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN: Would run smoke tests"
        return 0
    fi

    if [[ -f "$PROJECT_ROOT/scripts/smoke-tests.sh" ]]; then
        if "$PROJECT_ROOT/scripts/smoke-tests.sh" "$ENVIRONMENT"; then
            log_success "Smoke tests passed"
        else
            log_error "Smoke tests failed"
            return 1
        fi
    else
        log_warning "Smoke tests script not found, skipping"
    fi
}

# =============================================================================
# NOTIFICATION FUNCTIONS
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

    local payload=$(cat << EOF
{
    "attachments": [
        {
            "color": "$color",
            "title": "Universal Translator Pro Deployment",
            "text": "$message",
            "fields": [
                {
                    "title": "Environment",
                    "value": "$ENVIRONMENT",
                    "short": true
                },
                {
                    "title": "Version",
                    "value": "$VERSION",
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
# ROLLBACK FUNCTION
# =============================================================================

rollback_deployment() {
    if [[ "$ROLLBACK_ON_FAILURE" == "false" ]]; then
        log_warning "Rollback disabled, manual intervention required"
        return 0
    fi

    log_warning "Rolling back deployment..."

    if [[ -f "$PROJECT_ROOT/scripts/rollback.sh" ]]; then
        "$PROJECT_ROOT/scripts/rollback.sh" "$ENVIRONMENT"
    else
        log_error "Rollback script not found"
        return 1
    fi
}

# =============================================================================
# CLEANUP FUNCTION
# =============================================================================

cleanup() {
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "Deployment failed with exit code $exit_code"
        
        if [[ "$FORCE_DEPLOY" == "false" ]]; then
            rollback_deployment
        fi
        
        send_slack_notification "error" "Deployment failed! Environment: $ENVIRONMENT, Version: $VERSION"
    else
        log_success "Deployment completed successfully"
        send_slack_notification "success" "Deployment successful! Environment: $ENVIRONMENT, Version: $VERSION"
    fi
    
    # Cleanup any temporary files
    rm -f /tmp/deployment_backup_name
    
    exit $exit_code
}

# =============================================================================
# MAIN DEPLOYMENT WORKFLOW
# =============================================================================

main() {
    parse_args "$@"
    
    log "Starting deployment to $ENVIRONMENT environment"
    log "Version: $VERSION"
    log "Dry run: $DRY_RUN"
    
    trap cleanup EXIT
    
    # Prerequisites
    check_prerequisites
    
    # Pre-deployment
    run_pre_deployment_tests
    create_backup
    
    # Deployment
    update_image_tags
    apply_manifests
    wait_for_rollout
    
    # Post-deployment
    run_health_checks
    run_smoke_tests
    
    log_success "Deployment completed successfully!"
}

# =============================================================================
# SCRIPT EXECUTION
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi