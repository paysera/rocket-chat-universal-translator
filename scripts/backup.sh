#!/bin/bash
set -euo pipefail

# =============================================================================
# Universal Translator Pro - Backup Script
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
readonly BACKUP_DIR="/opt/prod/backups"

# Default values
ENVIRONMENT="production"
NAMESPACE="universal-translator-prod"
BACKUP_NAME=""
BACKUP_TYPE="full"
COMPRESSION=true
VERIFY_BACKUP=true
UPLOAD_TO_S3=true
RETENTION_DAYS=30

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

# =============================================================================
# BACKUP FUNCTIONS
# =============================================================================

create_database_backup() {
    log "Creating database backup..."
    
    local backup_file="${BACKUP_DIR}/database/translator_${BACKUP_NAME}.dump"
    mkdir -p "$(dirname "$backup_file")"
    
    # Get database credentials from Kubernetes secret
    local db_host=$(kubectl get service postgresql -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    local db_user=$(kubectl get secret postgresql-secret -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_USER}' | base64 -d)
    local db_name=$(kubectl get secret postgresql-secret -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_DB}' | base64 -d)
    local db_password=$(kubectl get secret postgresql-secret -n "$NAMESPACE" -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
    
    # Port forward to database
    kubectl port-forward -n "$NAMESPACE" service/postgresql 5432:5432 &
    local port_forward_pid=$!
    sleep 3
    
    # Create backup
    PGPASSWORD="$db_password" pg_dump \
        --host=localhost --port=5432 \
        --username="$db_user" --dbname="$db_name" \
        --compress=9 --format=custom \
        --file="$backup_file"
    
    # Stop port forward
    kill $port_forward_pid 2>/dev/null || true
    
    log_success "Database backup created: $backup_file"
    echo "$backup_file"
}

create_redis_backup() {
    log "Creating Redis backup..."
    
    local backup_file="${BACKUP_DIR}/redis/redis_${BACKUP_NAME}.rdb"
    mkdir -p "$(dirname "$backup_file")"
    
    # Port forward to Redis
    kubectl port-forward -n "$NAMESPACE" service/redis 6379:6379 &
    local port_forward_pid=$!
    sleep 3
    
    # Create Redis backup
    redis-cli --rdb "$backup_file" || true
    
    # Stop port forward
    kill $port_forward_pid 2>/dev/null || true
    
    if [[ -f "$backup_file" ]]; then
        log_success "Redis backup created: $backup_file"
        echo "$backup_file"
    else
        log_warning "Redis backup failed or empty"
        echo ""
    fi
}

create_files_backup() {
    log "Creating application files backup..."
    
    local backup_file="${BACKUP_DIR}/files/app_files_${BACKUP_NAME}.tar.gz"
    mkdir -p "$(dirname "$backup_file")"
    
    # Create tarball of application files
    tar -czf "$backup_file" \
        -C /opt/prod/data/translator \
        logs/ uploads/ || true
    
    if [[ -f "$backup_file" ]]; then
        log_success "Files backup created: $backup_file"
        echo "$backup_file"
    else
        log_warning "Files backup failed or empty"
        echo ""
    fi
}

verify_backup() {
    local backup_file="$1"
    local backup_type="$2"
    
    if [[ ! -f "$backup_file" ]]; then
        log_error "Backup file not found: $backup_file"
        return 1
    fi
    
    case "$backup_type" in
        "database")
            # Verify PostgreSQL dump
            if pg_restore --list "$backup_file" &> /dev/null; then
                log_success "Database backup verified"
                return 0
            else
                log_error "Database backup verification failed"
                return 1
            fi
            ;;
        "files")
            # Verify tarball
            if tar -tzf "$backup_file" &> /dev/null; then
                log_success "Files backup verified"
                return 0
            else
                log_error "Files backup verification failed"
                return 1
            fi
            ;;
        *)
            # Generic file existence check
            log_success "Backup file exists: $backup_file"
            return 0
            ;;
    esac
}

upload_to_s3() {
    local backup_file="$1"
    local backup_type="$2"
    
    if [[ "$UPLOAD_TO_S3" != "true" ]]; then
        return 0
    fi
    
    log "Uploading backup to S3..."
    
    local s3_bucket="translator-backups-prod"
    local s3_key="${backup_type}/$(date +%Y/%m/%d)/$(basename "$backup_file")"
    
    if aws s3 cp "$backup_file" "s3://${s3_bucket}/${s3_key}" \
        --sse AES256 \
        --storage-class STANDARD_IA; then
        log_success "Backup uploaded to S3: s3://${s3_bucket}/${s3_key}"
    else
        log_error "Failed to upload backup to S3"
        return 1
    fi
}

cleanup_old_backups() {
    log "Cleaning up old backups..."
    
    # Clean local backups older than retention period
    find "$BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    find "$BACKUP_DIR" -name "*.rdb" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    
    log_success "Old backups cleaned up"
}

# =============================================================================
# MAIN BACKUP FUNCTION
# =============================================================================

main() {
    # Set default backup name if not provided
    if [[ -z "$BACKUP_NAME" ]]; then
        BACKUP_NAME="$(date +%Y%m%d_%H%M%S)"
    fi
    
    log "Starting backup process..."
    log "Environment: $ENVIRONMENT"
    log "Backup Name: $BACKUP_NAME"
    log "Backup Type: $BACKUP_TYPE"
    
    # Ensure backup directory exists
    mkdir -p "$BACKUP_DIR"/{database,redis,files}
    
    local backup_files=()
    local backup_success=true
    
    # Create backups based on type
    if [[ "$BACKUP_TYPE" == "full" || "$BACKUP_TYPE" == "database" ]]; then
        if db_backup=$(create_database_backup); then
            backup_files+=("$db_backup:database")
        else
            backup_success=false
        fi
    fi
    
    if [[ "$BACKUP_TYPE" == "full" || "$BACKUP_TYPE" == "redis" ]]; then
        if redis_backup=$(create_redis_backup); then
            [[ -n "$redis_backup" ]] && backup_files+=("$redis_backup:redis")
        fi
    fi
    
    if [[ "$BACKUP_TYPE" == "full" || "$BACKUP_TYPE" == "files" ]]; then
        if files_backup=$(create_files_backup); then
            [[ -n "$files_backup" ]] && backup_files+=("$files_backup:files")
        fi
    fi
    
    # Verify backups
    if [[ "$VERIFY_BACKUP" == "true" ]]; then
        log "Verifying backups..."
        for backup_info in "${backup_files[@]}"; do
            local backup_file=$(echo "$backup_info" | cut -d: -f1)
            local backup_type=$(echo "$backup_info" | cut -d: -f2)
            
            if ! verify_backup "$backup_file" "$backup_type"; then
                backup_success=false
            fi
        done
    fi
    
    # Upload to S3
    for backup_info in "${backup_files[@]}"; do
        local backup_file=$(echo "$backup_info" | cut -d: -f1)
        local backup_type=$(echo "$backup_info" | cut -d: -f2)
        
        if ! upload_to_s3 "$backup_file" "$backup_type"; then
            backup_success=false
        fi
    done
    
    # Cleanup old backups
    cleanup_old_backups
    
    # Report results
    if [[ "$backup_success" == "true" ]]; then
        log_success "Backup completed successfully"
        log "Backup files created: ${#backup_files[@]}"
        for backup_info in "${backup_files[@]}"; do
            local backup_file=$(echo "$backup_info" | cut -d: -f1)
            log "  - $(basename "$backup_file")"
        done
        return 0
    else
        log_error "Backup completed with errors"
        return 1
    fi
}

# =============================================================================
# SCRIPT EXECUTION
# =============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --environment|-e)
                ENVIRONMENT="$2"
                shift 2
                ;;
            --name|-n)
                BACKUP_NAME="$2"
                shift 2
                ;;
            --type|-t)
                BACKUP_TYPE="$2"
                shift 2
                ;;
            --no-compression)
                COMPRESSION=false
                shift
                ;;
            --no-verify)
                VERIFY_BACKUP=false
                shift
                ;;
            --no-upload)
                UPLOAD_TO_S3=false
                shift
                ;;
            --retention)
                RETENTION_DAYS="$2"
                shift 2
                ;;
            *)
                if [[ -z "$BACKUP_NAME" ]]; then
                    BACKUP_NAME="$1"
                fi
                shift
                ;;
        esac
    done
    
    # Set namespace based on environment
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        NAMESPACE="universal-translator-staging"
    fi
    
    main "$@"
fi