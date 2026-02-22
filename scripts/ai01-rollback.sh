#!/usr/bin/env bash
set -euo pipefail

# AI01 Rollback Script
# Restore runtime files from backup bundle and restart Plexus service
#
# Usage: ./ai01-rollback.sh [--backup-id BACKUP_ID|--backup-path PATH] [--dry-run]
#
# Options:
#   --backup-id ID     Use specific backup ID (timestamp format: YYYYMMDD-HHMMSS)
#   --backup-path PATH Use explicit backup archive path
#   --dry-run          Log actions without executing
#
# If neither --backup-id nor --backup-path specified, uses latest valid backup.
#
# Exits non-zero on any failure.

DRY_RUN=false
BACKUP_ID=""
BACKUP_PATH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-id)
      BACKUP_ID="${2:-}"
      shift 2
      ;;
    --backup-path)
      BACKUP_PATH="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      echo "Usage: $0 [--backup-id ID|--backup-path PATH] [--dry-run]"
      echo ""
      echo "Restore Plexus runtime files from backup and restart service."
      echo ""
      echo "Options:"
      echo "  --backup-id ID     Restore from backup with timestamp ID"
      echo "  --backup-path PATH Restore from explicit backup archive path"
      echo "  --dry-run          Log actions without executing"
      echo "  --help             Show this help message"
      echo ""
      echo "If neither --backup-id nor --backup-path is specified, uses latest backup."
      echo ""
      echo "Environment variables:"
      echo "  AI01_SSH           SSH connection string (default: user001@100.96.49.42)"
      echo "  AI01_DIR           Remote Plexus directory (default: ~/plexus)"
      echo "  PLEXUS_BACKUP_ROOT Local backup root (default: \${HOME}/.plexus-backups)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use --help for usage information" >&2
      exit 1
      ;;
  esac
done

# Environment-configurable defaults
AI01_SSH="${AI01_SSH:-user001@100.96.49.42}"
AI01_DIR="${AI01_DIR:-~/plexus}"

# Hidden backup convention: use ~/.plexus-backups
PLEXUS_BACKUP_ROOT="${PLEXUS_BACKUP_ROOT:-${HOME}/.plexus-backups}"

# Runtime files to restore (space-separated)
PLEXUS_RUNTIME_FILES=".env plexus.yaml start-plexus.sh stop-plexus.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Lock mechanism: use mkdir for atomic lock acquisition
LOCK_DIR="${PLEXUS_ROLLBACK_LOCK_DIR:-/tmp/plexus-rollback.lock}"
LOCK_ACQUIRED=false

acquire_lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    return 1
  fi
  LOCK_ACQUIRED=true
  return 0
}

release_lock() {
  if [[ "$LOCK_ACQUIRED" == true ]] && [[ -d "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCK_ACQUIRED=false
  fi
}

cleanup_on_exit() {
  release_lock
}

trap cleanup_on_exit EXIT

log() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

# Resolve backup path from explicit path, ID, or find latest
# Outputs only the path to stdout; all diagnostics go to stderr
resolve_backup_path() {
  # Case 1: Explicit path provided
  if [[ -n "$BACKUP_PATH" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
      log "[DRY-RUN] Would use explicit backup path: $BACKUP_PATH" >&2
    fi
    echo "$BACKUP_PATH"
    return 0
  fi

  # Case 2: Backup ID provided - check candidate paths in order
  if [[ -n "$BACKUP_ID" ]]; then
    local candidates=(
      "$PLEXUS_BACKUP_ROOT/ai01-$BACKUP_ID/runtime-backup-$BACKUP_ID.tar.gz"
      "$PLEXUS_BACKUP_ROOT/deploy-$BACKUP_ID/runtime-backup-$BACKUP_ID.tar.gz"
      "$PLEXUS_BACKUP_ROOT/$BACKUP_ID/ai01/config-files.tgz"
    )
    for candidate in "${candidates[@]}"; do
      if [[ -f "$candidate" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
          log "[DRY-RUN] Would use backup from ID: $BACKUP_ID" >&2
          log "[DRY-RUN]   Path: $candidate" >&2
        fi
        echo "$candidate"
        return 0
      fi
    done
    err "Backup ID not found: $BACKUP_ID" >&2
    err "Checked paths:" >&2
    for candidate in "${candidates[@]}"; do
      err "  - $candidate" >&2
    done
    return 1
  fi

  # Case 3: Find latest valid backup
  log "Finding latest backup..." >&2

  if [[ ! -d "$PLEXUS_BACKUP_ROOT" ]]; then
    err "Backup root directory not found: $PLEXUS_BACKUP_ROOT" >&2
    err "No backups available for rollback" >&2
    return 1
  fi

  # Look for runtime-backup-*.tar.gz files (covers ai01-* and deploy-* dirs)
  local latest_backup
  latest_backup=$(find "$PLEXUS_BACKUP_ROOT" -type f -name "runtime-backup-*.tar.gz" 2>/dev/null | sort -r | head -1)

  if [[ -z "$latest_backup" ]]; then
    # Fallback: check update-from-upstream format (config-files.tgz in timestamped dirs)
    latest_backup=$(find "$PLEXUS_BACKUP_ROOT" -type f -name "config-files.tgz" 2>/dev/null | sort -r | head -1)
  fi

  if [[ -z "$latest_backup" ]]; then
    err "No valid backup found in: $PLEXUS_BACKUP_ROOT" >&2
    return 1
  fi

  log "Latest backup found: $latest_backup" >&2
  echo "$latest_backup"
}

# Validate backup exists and is readable
validate_backup() {
  local backup_path="$1"

  log "Validating backup: $backup_path"

  if [[ ! -f "$backup_path" ]]; then
    err "Backup file not found: $backup_path"
    return 1
  fi

  if [[ ! -r "$backup_path" ]]; then
    err "Backup file not readable: $backup_path"
    return 1
  fi

  # Check if it's a valid tar.gz
  if [[ "$DRY_RUN" != "true" ]]; then
    if ! tar -tzf "$backup_path" >/dev/null 2>&1; then
      err "Backup file is not a valid tar.gz archive: $backup_path"
      return 1
    fi

    # Verify it contains expected files
    local missing=0
    for file in $PLEXUS_RUNTIME_FILES; do
      if ! tar -tzf "$backup_path" | grep -q "^${file}$" && ! tar -tzf "$backup_path" | grep -q "/${file}$"; then
        warn "Backup missing expected file: $file"
        ((missing++))
      fi
    done

    if [[ $missing -gt 0 ]]; then
      err "Backup is missing $missing expected file(s)"
      return 1
    fi
  fi

  log "Backup validated successfully"
  return 0
}

# Transfer backup to AI01 temp location
transfer_backup() {
  local local_path="$1"
  local remote_path="$2"

  log "Transferring backup to AI01..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would transfer: $local_path"
    log "[DRY-RUN]   To: $AI01_SSH:$remote_path"
    return 0
  fi

  # Ensure remote temp directory exists
  local remote_temp_dir
  remote_temp_dir=$(ssh "$AI01_SSH" "mktemp -d /tmp/plexus-rollback.XXXXXX")

  if ! scp "$local_path" "$AI01_SSH:$remote_temp_dir/backup.tar.gz"; then
    err "Failed to transfer backup to AI01"
    return 1
  fi

  echo "$remote_temp_dir/backup.tar.gz"
}

# Execute rollback on AI01
execute_rollback() {
  local remote_backup_path="$1"

  log "Executing rollback on AI01..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would execute on AI01:"
    log "[DRY-RUN]   1. Stop Plexus container"
    log "[DRY-RUN]   2. Backup current runtime files"
    log "[DRY-RUN]   3. Extract backup archive to $AI01_DIR"
    log "[DRY-RUN]   4. Set appropriate permissions"
    log "[DRY-RUN]   5. Start Plexus container"
    return 0
  fi

  local rollback_script
  rollback_script=$(cat <<'REMOTE_SCRIPT'
set -e
BACKUP_PATH="$1"
PLEXUS_DIR="${2:-~/plexus}"

# Stop Plexus if running
if [[ -x "$PLEXUS_DIR/stop-plexus.sh" ]]; then
  echo "[INFO] Stopping Plexus..."
  cd "$PLEXUS_DIR" && ./stop-plexus.sh || true
else
  echo "[WARN] stop-plexus.sh not found or not executable"
fi

# Create pre-rollback backup of current state
TS="$(date +%Y%m%d-%H%M%S)"
PRE_ROLLBACK_BACKUP="$PLEXUS_DIR/.plexus-backups/pre-rollback-backup-$TS.tar.gz"
mkdir -p "$PLEXUS_DIR/.plexus-backups"

# Backup current files if they exist
if [[ -f "$PLEXUS_DIR/.env" ]] || [[ -f "$PLEXUS_DIR/plexus.yaml" ]]; then
  echo "[INFO] Creating pre-rollback backup: $PRE_ROLLBACK_BACKUP"
  tar -czf "$PRE_ROLLBACK_BACKUP" -C "$PLEXUS_DIR" .env plexus.yaml start-plexus.sh stop-plexus.sh 2>/dev/null || true
fi

# Extract rollback backup
echo "[INFO] Restoring from backup..."
tar -xzf "$BACKUP_PATH" -C "$PLEXUS_DIR"

# Set permissions
chmod 600 "$PLEXUS_DIR/.env" 2>/dev/null || true
chmod +x "$PLEXUS_DIR/start-plexus.sh" "$PLEXUS_DIR/stop-plexus.sh" 2>/dev/null || true

# Start Plexus
echo "[INFO] Starting Plexus..."
if [[ -x "$PLEXUS_DIR/start-plexus.sh" ]]; then
  cd "$PLEXUS_DIR" && ./start-plexus.sh
  echo "[INFO] Plexus started successfully"
else
  echo "[ERROR] start-plexus.sh not found or not executable"
  exit 1
fi

# Cleanup temp backup file
rm -f "$BACKUP_PATH"
echo "[INFO] Rollback complete"
REMOTE_SCRIPT
)

  # Execute rollback script remotely
  if ! echo "$rollback_script" | ssh "$AI01_SSH" "bash -s -- $remote_backup_path $AI01_DIR"; then
    err "Rollback execution failed on AI01"
    return 1
  fi

  log "Rollback executed successfully on AI01"
  return 0
}

# Run smoke test
run_smoke_test() {
  log "Running post-rollback smoke test..."

  local smoke_script="$REPO_DIR/scripts/ai01-smoke-test.sh"

  if [[ ! -f "$smoke_script" ]]; then
    warn "Smoke test script not found: $smoke_script"
    return 1
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would execute: $smoke_script"
    return 0
  fi

  log "Executing smoke test: $smoke_script"

  if "$smoke_script"; then
    log "Smoke test PASSED"
    return 0
  else
    err "Smoke test FAILED"
    return 1
  fi
}

# Print final summary
print_summary() {
  local status="$1"
  local backup_path="$2"
  local smoke_status="${3:-unknown}"

  echo ""
  echo "=========================================="
  echo "ROLLBACK SUMMARY"
  echo "=========================================="
  echo "Status: $status"
  echo "Backup: $backup_path"
  echo "Target: $AI01_SSH:$AI01_DIR"
  echo "Smoke Test: $smoke_status"
  echo "=========================================="
}

main() {
  log "AI01 Rollback Starting"
  log "Target: $AI01_SSH:$AI01_DIR"
  log "Dry Run: $DRY_RUN"
  echo ""

  # Preflight checks: required commands
  need_cmd ssh
  need_cmd scp
  need_cmd tar
  need_cmd date
  need_cmd printf
  need_cmd dirname
  need_cmd pwd
  need_cmd command
  need_cmd test
  need_cmd find

  # Preflight: lock acquisition
  if ! acquire_lock; then
    err "Another rollback is already running (lock dir exists: $LOCK_DIR)"
    err "If this is a stale lock, remove it with: rmdir $LOCK_DIR"
    exit 3
  fi

  # Preflight: backup root exists
  if [[ ! -d "$PLEXUS_BACKUP_ROOT" ]]; then
    err "Backup root directory does not exist: $PLEXUS_BACKUP_ROOT"
    exit 1
  fi

  # Preflight: SSH connectivity
  log "Checking SSH connectivity to $AI01_SSH..."
  if ! ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$AI01_SSH" "echo 'SSH OK'" >/dev/null 2>&1; then
    err "Cannot reach AI01 via SSH: $AI01_SSH"
    err "Check network, host key, or credentials"
    exit 1
  fi
  log "SSH connectivity confirmed"
  echo ""

  # Step 1: Resolve backup path
  local backup_path
  if ! backup_path=$(resolve_backup_path); then
    err "=========================================="
    err "ROLLBACK ABORTED: No valid backup found"
    err "=========================================="
    exit 1
  fi

  # Step 2: Validate backup
  if ! validate_backup "$backup_path"; then
    err "=========================================="
    err "ROLLBACK ABORTED: Backup validation failed"
    err "=========================================="
    exit 1
  fi

  # Step 3: Transfer backup to AI01
  local remote_backup_path
  if [[ "$DRY_RUN" != "true" ]]; then
    remote_backup_path=$(transfer_backup "$backup_path" "/tmp/plexus-rollback-backup.tar.gz")
    if [[ $? -ne 0 ]] || [[ -z "$remote_backup_path" ]]; then
      err "=========================================="
      err "ROLLBACK ABORTED: Backup transfer failed"
      err "=========================================="
      exit 1
    fi
  else
    remote_backup_path="/tmp/plexus-rollback-backup.tar.gz"
  fi

  # Step 4: Execute rollback
  if ! execute_rollback "$remote_backup_path"; then
    err "=========================================="
    err "ROLLBACK ABORTED: Remote execution failed"
    err "=========================================="
    exit 1
  fi

  # Step 5: Run smoke test
  local smoke_result=0
  if ! run_smoke_test; then
    smoke_result=1
  fi

  # Final summary
  local smoke_status="PASSED"
  local final_status="SUCCESS"
  if [[ $smoke_result -ne 0 ]]; then
    smoke_status="FAILED"
    final_status="PARTIAL (Smoke test failed)"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    final_status="DRY-RUN (no mutations)"
    smoke_status="N/A"
  fi

  print_summary "$final_status" "$backup_path" "$smoke_status"

  # Exit non-zero if smoke test failed
  if [[ $smoke_result -ne 0 ]]; then
    exit 1
  fi

  exit 0
}

main "$@"
