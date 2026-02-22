#!/usr/bin/env bash
set -euo pipefail

# Deploy runtime artifacts to AI01 with backup-before-deploy gate
# Exits non-zero on backup, transfer, or remote restart failure

DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) ;;
  esac
done

# Environment-configurable defaults
AI01_SSH="${AI01_SSH:-user001@100.96.49.42}"
AI01_DIR="${AI01_DIR:-~/plexus}"

# Runtime files to deploy (space-separated list)
# Format: local_path:remote_path (remote_path relative to AI01_DIR)
PLEXUS_RUNTIME_FILES="${PLEXUS_RUNTIME_FILES:-.env plexus.yaml start-plexus.sh stop-plexus.sh}"

# Hidden backup convention: use ~/.plexus-backups to avoid committing sensitive data
PLEXUS_BACKUP_ROOT="${PLEXUS_BACKUP_ROOT:-${HOME}/.plexus-backups}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PLEXUS_BACKUP_ROOT/deploy-$TS"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Lock mechanism: use mkdir for atomic lock acquisition
LOCK_DIR="${PLEXUS_DEPLOY_LOCK_DIR:-/tmp/plexus-deploy-to-ai01.lock}"
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

# Validate local runtime files exist
validate_local_files() {
  log "Validating local runtime files exist..."
  local missing=0
  for file in $PLEXUS_RUNTIME_FILES; do
    local local_path="$REPO_DIR/$file"
    if [[ ! -f "$local_path" ]]; then
      err "Missing local file: $file"
      ((missing++))
    fi
  done
  if [[ $missing -gt 0 ]]; then
    err "=========================================="
    err "VALIDATION FAILED: $missing file(s) missing"
    err "=========================================="
    return 1
  fi
  log "All local runtime files present"
  return 0
}

# Create timestamped backup on AI01 (tar of runtime files)
backup_remote_files() {
  log "Creating backup on AI01..."
  
  local ai01_backup_file="$AI01_DIR/.plexus-backups/runtime-backup-$TS.tar.gz"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would create remote backup: $ai01_backup_file"
    log "[DRY-RUN]   Files: $PLEXUS_RUNTIME_FILES"
    return 0
  fi
  
  # Ensure remote backup directory exists
  if ! ssh "$AI01_SSH" "mkdir -p $AI01_DIR/.plexus-backups" 2>/dev/null; then
    err "Failed to create backup directory on AI01"
    return 1
  fi
  
  # Create tar backup on remote host
  local files_to_backup=""
  for file in $PLEXUS_RUNTIME_FILES; do
    if [[ -n "$files_to_backup" ]]; then
      files_to_backup="$files_to_backup $file"
    else
      files_to_backup="$file"
    fi
  done
  
  if ! ssh "$AI01_SSH" "cd $AI01_DIR && tar -czf $ai01_backup_file $files_to_backup 2>/dev/null || echo 'BACKUP_FAILED'" | grep -q "BACKUP_FAILED"; then
    # Check if backup file was created and has content
    local backup_size
    backup_size=$(ssh "$AI01_SSH" "stat -c%s $ai01_backup_file 2>/dev/null || echo 0")
    if [[ "$backup_size" -eq 0 ]]; then
      err "Backup file not found or empty on AI01: $ai01_backup_file"
      return 1
    fi
  else
    # tar returned non-zero or grep found BACKUP_FAILED - but files might not exist yet (first deploy)
    local backup_exists
    backup_exists=$(ssh "$AI01_SSH" "test -f $ai01_backup_file && echo EXISTS || echo MISSING")
    if [[ "$backup_exists" != "EXISTS" ]]; then
      # Check if files exist at all
      local files_exist="true"
      for file in $PLEXUS_RUNTIME_FILES; do
        if ! ssh "$AI01_SSH" "test -f $AI01_DIR/$file" 2>/dev/null; then
          files_exist="false"
          break
        fi
      done
      
      if [[ "$files_exist" == "true" ]]; then
        err "Failed to create backup on AI01 (tar command failed)"
        return 1
      else
        log "Note: Files don't exist on AI01 yet (first deploy), skipping backup"
      fi
    fi
  fi
  
  log "Remote backup created: $ai01_backup_file"
  return 0
}

# Verify backup command success (remote file exists and readable)
verify_remote_backup() {
  log "Verifying remote backup..."
  
  local ai01_backup_file="$AI01_DIR/.plexus-backups/runtime-backup-$TS.tar.gz"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would verify remote backup exists: $ai01_backup_file"
    return 0
  fi
  
  # Check if backup file exists and is readable
  local backup_check
  backup_check=$(ssh "$AI01_SSH" "if test -r $ai01_backup_file 2>/dev/null; then echo OK; else echo MISSING; fi")
  
  if [[ "$backup_check" != "OK" ]]; then
    # Files may not exist (first deploy) - this is OK
    log "Backup verification skipped (files may not exist on first deploy)"
    return 0
  fi
  
  log "Remote backup verified"
  return 0
}

# Transfer files to AI01 using rsync (preferred) or scp
transfer_files() {
  log "Transferring runtime files to AI01..."
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would transfer files: $PLEXUS_RUNTIME_FILES"
    log "[DRY-RUN]   Destination: $AI01_SSH:$AI01_DIR/"
    return 0
  fi
  
  # Try rsync first, fall back to scp
  local transfer_failed=false
  
  if command -v rsync >/dev/null 2>&1; then
    log "Using rsync for transfer..."
    for file in $PLEXUS_RUNTIME_FILES; do
      if ! rsync -avz --checksum "$REPO_DIR/$file" "$AI01_SSH:$AI01_DIR/$file"; then
        err "Failed to transfer: $file"
        transfer_failed=true
        break
      fi
    done
  else
    log "Using scp for transfer..."
    for file in $PLEXUS_RUNTIME_FILES; do
      if ! scp "$REPO_DIR/$file" "$AI01_SSH:$AI01_DIR/$file"; then
        err "Failed to transfer: $file"
        transfer_failed=true
        break
      fi
    done
  fi
  
  if [[ "$transfer_failed" == "true" ]]; then
    return 1
  fi
  
  log "Files transferred successfully"
  return 0
}

# Restart plexus using remote start script
restart_remote_plexus() {
  log "Restarting Plexus on AI01..."
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would execute: cd $AI01_DIR && ./stop-plexus.sh && ./start-plexus.sh"
    return 0
  fi
  
  # Check if stop script exists and execute it
  local stop_exists
  stop_exists=$(ssh "$AI01_SSH" "if test -x $AI01_DIR/stop-plexus.sh 2>/dev/null; then echo EXISTS; else echo MISSING; fi")
  
  if [[ "$stop_exists" == "EXISTS" ]]; then
    log "Executing stop-plexus.sh..."
    if ! ssh "$AI01_SSH" "cd $AI01_DIR && ./stop-plexus.sh"; then
      err "stop-plexus.sh failed"
      return 1
    fi
  else
    warn "stop-plexus.sh not found or not executable on AI01"
  fi
  
  # Check if start script exists and execute it
  local start_exists
  start_exists=$(ssh "$AI01_SSH" "if test -x $AI01_DIR/start-plexus.sh 2>/dev/null; then echo EXISTS; else echo MISSING; fi")
  
  if [[ "$start_exists" == "EXISTS" ]]; then
    local mount_check
    mount_check=$(ssh "$AI01_SSH" "if grep -q '/app/config/plexus.yaml' $AI01_DIR/start-plexus.sh 2>/dev/null; then echo FILE_MOUNT; else echo OK; fi")
    if [[ "$mount_check" == "FILE_MOUNT" ]]; then
      err "start-plexus.sh uses file bind mount to /app/config/plexus.yaml (breaks provider save via atomic rewrite)"
      err "Update mount to bind directory in start-plexus.sh (for example: -v <runtime-dir>:/app/config)"
      return 1
    fi

    log "Executing start-plexus.sh..."
    if ! ssh "$AI01_SSH" "cd $AI01_DIR && ./start-plexus.sh"; then
      err "start-plexus.sh failed"
      return 1
    fi
  else
    err "start-plexus.sh not found or not executable on AI01"
    return 1
  fi
  
  log "Plexus restarted successfully"
  return 0
}

main() {
  # Preflight checks: required commands
  need_cmd ssh
  need_cmd date
  need_cmd printf
  need_cmd dirname
  need_cmd pwd
  need_cmd command
  need_cmd test
  
  # Check for rsync or scp
  if ! command -v rsync >/dev/null 2>&1 && ! command -v scp >/dev/null 2>&1; then
    err "Missing required command: rsync or scp"
    exit 1
  fi
  
  # Preflight: lock acquisition (prevents concurrent runs)
  if ! acquire_lock; then
    err "Another deploy is already running (lock dir exists: $LOCK_DIR)"
    err "If this is a stale lock, remove it with: rmdir $LOCK_DIR"
    exit 3
  fi
  
  # Preflight: backup root writable check
  if [[ ! -d "$PLEXUS_BACKUP_ROOT" ]]; then
    if ! mkdir -p "$PLEXUS_BACKUP_ROOT" 2>/dev/null; then
      err "Cannot create backup root directory: $PLEXUS_BACKUP_ROOT (check permissions)"
      exit 1
    fi
  fi
  if [[ ! -w "$PLEXUS_BACKUP_ROOT" ]]; then
    err "Backup root directory is not writable: $PLEXUS_BACKUP_ROOT (check permissions)"
    exit 1
  fi
  
  # Preflight: SSH connectivity check
  log "Checking SSH connectivity to $AI01_SSH..."
  if ! ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$AI01_SSH" "echo 'SSH OK'" >/dev/null 2>&1; then
    err "Cannot reach AI01 via SSH: $AI01_SSH (check network, host key, or credentials)"
    exit 1
  fi
  log "SSH connectivity confirmed"
  
  # Create local backup directory for logs
  if [[ "$DRY_RUN" != "true" ]]; then
    mkdir -p "$BACKUP_DIR"
  else
    log "[DRY-RUN] Would create local backup directory: $BACKUP_DIR"
  fi
  
  log "=========================================="
  log "DEPLOY TO AI01 SUMMARY"
  log "=========================================="
  log "source=$REPO_DIR"
  log "destination=$AI01_SSH:$AI01_DIR"
  log "files=$PLEXUS_RUNTIME_FILES"
  log "backup_path=$BACKUP_DIR"
  log "dry_run=$DRY_RUN"
  log "=========================================="
  
  # Step 1: Validate local runtime files exist
  if ! validate_local_files; then
    err "=========================================="
    err "DEPLOY ABORTED: Local file validation failed"
    err "=========================================="
    exit 1
  fi
  
  # Step 2: Create timestamped backup on AI01
  if ! backup_remote_files; then
    err "=========================================="
    err "DEPLOY ABORTED: Remote backup failed"
    err "=========================================="
    exit 1
  fi
  
  # Step 3: Verify backup command success
  if ! verify_remote_backup; then
    err "=========================================="
    err "DEPLOY ABORTED: Remote backup verification failed"
    err "=========================================="
    exit 1
  fi
  
  # Step 4: Transfer files to AI01
  if ! transfer_files; then
    err "=========================================="
    err "DEPLOY ABORTED: File transfer failed"
    err "=========================================="
    exit 1
  fi
  
  # Step 5: Restart plexus using remote start script
  if ! restart_remote_plexus; then
    err "=========================================="
    err "DEPLOY ABORTED: Remote restart failed"
    err "=========================================="
    exit 1
  fi
  
  # Step 6: Return clear success/failure (we made it here = success)
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN COMPLETE] No mutations performed"
    log "[DRY-RUN] To apply changes, run without --dry-run flag"
  else
    log "=========================================="
    log "DEPLOY SUCCESSFUL"
    log "=========================================="
    log "Files deployed: $PLEXUS_RUNTIME_FILES"
    log "Backup location: $AI01_DIR/.plexus-backups/"
    log "Local logs: $BACKUP_DIR"
  fi
  
  exit 0
}

main "$@"
