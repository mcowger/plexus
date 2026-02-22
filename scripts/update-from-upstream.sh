#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) ;;
  esac
done

# Preserve manifest: files that must be preserved across upstream merges
# Format: path|required
# required=true: file must exist at backup time, failure is fatal
# required=false: file is optional, missing is allowed
declare -a PRESERVE_MANIFEST=(
  ".env|true"
  "plexus.yaml|true"
  "start-plexus.sh|true"
  "stop-plexus.sh|true"
  "config/plexus.yaml|false"
)

MANIFEST_FILENAME="preserve-manifest.sha256"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Lock mechanism: use mkdir for atomic lock acquisition
LOCK_DIR="${PLEXUS_UPDATE_LOCK_DIR:-/tmp/plexus-update-from-upstream.lock}"
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

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-mcowger}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/mcowger/plexus.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"

AI01_SSH="${AI01_SSH:-user001@100.96.49.42}"
AI01_DIR="${AI01_DIR:-~/plexus}"
SKIP_REMOTE_BACKUP="${SKIP_REMOTE_BACKUP:-false}"
# Hidden storage convention: use ~/.plexus-backups to avoid committing sensitive data to git
# See $REPO_DIR/docs/runbooks/upstream-sync-security.md for artifact map and rationale
PLEXUS_BACKUP_ROOT="${PLEXUS_BACKUP_ROOT:-${HOME}/.plexus-backups}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$PLEXUS_BACKUP_ROOT/$TS}"

log() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

backup_local_file() {
  local rel="$1"
  local required="$2"
  local src="$REPO_DIR/$rel"
  local dst="$BACKUP_DIR/local/$rel"
  if [[ -f "$src" ]]; then
    if [[ "$DRY_RUN" != "true" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp -a "$src" "$dst"
      printf '%s\n' "$rel" >> "$BACKUP_DIR/local/restored-files.list"
    else
      log "[DRY-RUN] Would backup local file: $rel -> $dst"
    fi
  elif [[ "$required" == "true" ]]; then
    err "Required file missing at backup time: $rel"
    return 1
  fi
}

generate_pre_merge_checksums() {
  local manifest_path="$BACKUP_DIR/local/$MANIFEST_FILENAME"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would generate pre-merge checksum manifest at: $manifest_path"
    return 0
  fi
  
  : > "$manifest_path"
  local entry path required
  for entry in "${PRESERVE_MANIFEST[@]}"; do
    path="${entry%%|*}"
    required="${entry##*|}"
    local src="$REPO_DIR/$path"
    
    if [[ -f "$src" ]]; then
      local checksum
      checksum=$(sha256sum "$src" | awk '{print $1}')
      printf '%s|%s|%s\n' "$checksum" "$path" "$required" >> "$manifest_path"
      log "Captured checksum for preserved file: $path"
    elif [[ "$required" == "true" ]]; then
      err "Required file missing at checksum capture: $path"
      return 1
    fi
  done
  
  log "Pre-merge checksum manifest written to: $manifest_path"
}

validate_post_restore_checksums() {
  local manifest_path="$BACKUP_DIR/local/$MANIFEST_FILENAME"
  local mismatches=0
  local missing=0
  
  if [[ ! -f "$manifest_path" ]]; then
    err "Checksum manifest not found at: $manifest_path"
    err "Cannot validate restored files - manifest missing"
    return 1
  fi
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would validate restored files against checksum manifest"
    return 0
  fi
  
  log "Validating restored files against checksum manifest..."
  
  while IFS='|' read -r expected_checksum path required; do
    local current_path="$REPO_DIR/$path"
    
    if [[ ! -f "$current_path" ]]; then
      if [[ "$required" == "true" ]]; then
        err "CHECKSUM VALIDATION FAILED: Required file missing after restore: $path"
        ((missing++))
      else
        warn "Optional file not restored (missing): $path"
      fi
      continue
    fi
    
    local actual_checksum
    actual_checksum=$(sha256sum "$current_path" | awk '{print $1}')
    
    if [[ "$actual_checksum" != "$expected_checksum" ]]; then
      err "CHECKSUM MISMATCH for file: $path"
      err "  Expected: $expected_checksum"
      err "  Actual:   $actual_checksum"
      ((mismatches++))
    else
      log "Checksum validated OK: $path"
    fi
  done < "$manifest_path"
  
  if [[ $mismatches -gt 0 ]] || [[ $missing -gt 0 ]]; then
    err "=========================================="
    err "CHECKSUM VALIDATION FAILED"
    err "=========================================="
    err "Mismatches: $mismatches"
    err "Missing required files: $missing"
    err "Backup directory with pre-merge state: $BACKUP_DIR"
    err "Manual recovery may be required"
    return 1
  fi
  
  log "All preserved files validated successfully"
  return 0
}

# Validate DATABASE_URL invariant after restore
# Compares restored .env DATABASE_URL against expected value from backup
validate_database_url_invariant() {
  local expected_env_path="$BACKUP_DIR/local/.env"
  local actual_env_path="$REPO_DIR/.env"
  
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would validate DATABASE_URL invariant"
    log "[DRY-RUN]   Expected source: $expected_env_path"
    log "[DRY-RUN]   Actual source: $actual_env_path"
    return 0
  fi
  
  if [[ ! -f "$expected_env_path" ]]; then
    err "DATABASE_URL INVARIANT FAILED: Expected .env backup not found at $expected_env_path"
    return 1
  fi
  
  if [[ ! -f "$actual_env_path" ]]; then
    err "DATABASE_URL INVARIANT FAILED: Restored .env not found at $actual_env_path"
    return 1
  fi
  
  # Extract DATABASE_URL values (handle both exported and non-exported formats)
  local expected_db_url actual_db_url
  expected_db_url=$(grep -E '^(export )?DATABASE_URL=' "$expected_env_path" | tail -1 | sed -E 's/^(export )?DATABASE_URL=//')
  actual_db_url=$(grep -E '^(export )?DATABASE_URL=' "$actual_env_path" | tail -1 | sed -E 's/^(export )?DATABASE_URL=//')
  
  if [[ -z "$expected_db_url" ]]; then
    err "DATABASE_URL INVARIANT FAILED: DATABASE_URL not found in expected .env backup"
    return 1
  fi
  
  if [[ -z "$actual_db_url" ]]; then
    err "DATABASE_URL INVARIANT FAILED: DATABASE_URL not found in restored .env"
    return 1
  fi
  
  if [[ "$expected_db_url" != "$actual_db_url" ]]; then
    err "=========================================="
    err "DATABASE_URL INVARIANT FAILED"
    err "=========================================="
    err "The restored DATABASE_URL does not match the expected value"
    err "Expected source: $expected_env_path"
    err "Actual source: $actual_env_path"
    err "Backup directory with valid state: $BACKUP_DIR"
    err "Manual recovery may be required"
    return 1
  fi
  
  log "DATABASE_URL invariant validated successfully"
  return 0
}


restore_local_file() {
  local rel="$1"
  local bak="$BACKUP_DIR/local/$rel"
  local dst="$REPO_DIR/$rel"
  if [[ -f "$bak" ]]; then
    if [[ "$DRY_RUN" != "true" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp -a "$bak" "$dst"
      log "Restored local custom file: $rel"
    else
      log "[DRY-RUN] Would restore local file: $rel"
    fi
  fi
}

generate_conflict_report() {
  local report_file="$BACKUP_DIR/conflict-report.json"
  local conflicted_files=
  conflicted_files=$(git -C "$REPO_DIR" diff --name-only --diff-filter=U 2>/dev/null | jq -R . | jq -s . 2>/dev/null || echo '[]')
  local dry_run_val="$DRY_RUN"

  if [[ -z "$conflicted_files" ]] || [[ "$conflicted_files" == "[]" ]]; then
    conflicted_files="[]"
  fi

  local json_content
  json_content=$(cat <<EOF
{
  "timestamp": "$TS",
  "repo": "$REPO_DIR",
  "current_branch": "$current_branch",
  "merge_target": "$merge_target",
  "conflicted_files": $conflicted_files,
  "dry_run": $dry_run_val
}
EOF
)

  if [[ "$DRY_RUN" != "true" ]]; then
    printf '%s\n' "$json_content" > "$report_file"
    log "Conflict report written to: $report_file"
  else
    log "[DRY-RUN] Would write conflict report to: $report_file"
    log "[DRY-RUN] Report content:"
    printf '%s\n' "$json_content" | while IFS= read -r line; do log "[DRY-RUN]   $line"; done
  fi
}

main() {
  # Preflight checks: required commands
  need_cmd git
  need_cmd ssh
  need_cmd tar
  need_cmd mkdir
  need_cmd cp
  need_cmd date
  need_cmd printf
  need_cmd dirname
  need_cmd pwd
  need_cmd command
  need_cmd test

  # Preflight: lock acquisition (prevents concurrent runs)
  if ! acquire_lock; then
    err "Another instance is already running (lock dir exists: $LOCK_DIR)"
    err "If this is a stale lock, remove it with: rmdir $LOCK_DIR"
    exit 3
  fi

  # Preflight: git repository check
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    err "Not a git repository: $REPO_DIR"
    exit 1
  fi

  # Preflight: clean working tree check
  if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    err "Working tree is not clean. Commit/stash changes before running this script."
    git -C "$REPO_DIR" status --short
    exit 1
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

  # Preflight: SSH connectivity check (non-destructive, quick timeout)
  if [[ "$SKIP_REMOTE_BACKUP" != "true" ]]; then
    log "Checking SSH connectivity to $AI01_SSH..."
    if ! ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$AI01_SSH" "echo 'SSH OK'" >/dev/null 2>&1; then
      err "Cannot reach AI01 via SSH: $AI01_SSH (check network, host key, or credentials)"
      exit 1
    fi
    log "SSH connectivity confirmed"
  fi

  if [[ "$DRY_RUN" != "true" ]]; then
    mkdir -p "$BACKUP_DIR/local" "$BACKUP_DIR/ai01"
  else
    log "[DRY-RUN] Would create backup directories: $BACKUP_DIR/{local,ai01}"
  fi

  log "Repository: $REPO_DIR"
  log "Backup dir: $BACKUP_DIR"

  if [[ "$DRY_RUN" != "true" ]]; then
    : > "$BACKUP_DIR/local/restored-files.list"
  else
    log "[DRY-RUN] Would initialize: $BACKUP_DIR/local/restored-files.list"
  fi
  
  # Backup all files in preserve manifest (required=true must exist)
  backup_local_file ".env" "true"
  backup_local_file "plexus.yaml" "true"
  backup_local_file "start-plexus.sh" "true"
  backup_local_file "stop-plexus.sh" "true"
  backup_local_file "config/plexus.yaml" "false"
  
  # Generate pre-merge checksum manifest
  if ! generate_pre_merge_checksums; then
    err "Failed to generate pre-merge checksums"
    exit 1
  fi

  if [[ "$SKIP_REMOTE_BACKUP" != "true" ]]; then
    log "Backing up AI01 settings from $AI01_SSH:$AI01_DIR"

    if [[ "$DRY_RUN" != "true" ]]; then
      ssh "$AI01_SSH" "cd $AI01_DIR && tar --ignore-failed-read -czf - .env plexus.yaml start-plexus.sh stop-plexus.sh" \
        > "$BACKUP_DIR/ai01/config-files.tgz"
    else
      log "[DRY-RUN] Would backup AI01 config to $BACKUP_DIR/ai01/config-files.tgz"
    fi

    if [[ "$DRY_RUN" != "true" ]]; then
      ssh "$AI01_SSH" "grep -E '^DATABASE_URL=' $AI01_DIR/.env || true" \
        > "$BACKUP_DIR/ai01/database-url.txt"
    else
      log "[DRY-RUN] Would extract DATABASE_URL from AI01 .env"
    fi

    if [[ "$DRY_RUN" != "true" ]]; then
      ssh "$AI01_SSH" "cd $AI01_DIR && sha256sum .env plexus.yaml start-plexus.sh stop-plexus.sh 2>/dev/null || true" \
        > "$BACKUP_DIR/ai01/checksums.txt"
    else
      log "[DRY-RUN] Would generate checksums of AI01 config files"
    fi
  else
    warn "Skipping AI01 backup (SKIP_REMOTE_BACKUP=true)"
  fi

  if git -C "$REPO_DIR" remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
    current_url="$(git -C "$REPO_DIR" remote get-url "$UPSTREAM_REMOTE")"
    if [[ "$current_url" != "$UPSTREAM_URL" ]]; then
      warn "Remote $UPSTREAM_REMOTE URL differs: $current_url"
      warn "Updating to: $UPSTREAM_URL"
      if [[ "$DRY_RUN" != "true" ]]; then
        git -C "$REPO_DIR" remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
      else
        log "[DRY-RUN] Would update remote $UPSTREAM_REMOTE URL to $UPSTREAM_URL"
      fi
    fi
  else
    log "Adding remote $UPSTREAM_REMOTE -> $UPSTREAM_URL"
    if [[ "$DRY_RUN" != "true" ]]; then
      git -C "$REPO_DIR" remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
    else
      log "[DRY-RUN] Would add remote $UPSTREAM_REMOTE -> $UPSTREAM_URL"
    fi
  fi

  current_branch="$(git -C "$REPO_DIR" branch --show-current)"
  merge_target="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  log "Current branch: $current_branch"

  # Print deterministic summary header (for both dry-run and real runs)
  log "=========================================="
  log "UPSTREAM SYNC SUMMARY"
  log "=========================================="
  log "repo=$REPO_DIR"
  log "branch=$current_branch"
  log "merge_target=$merge_target"
  log "backup_path=$BACKUP_DIR"
  log "dry_run=$DRY_RUN"
  log "=========================================="

  log "Fetching $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  if [[ "$DRY_RUN" != "true" ]]; then
    git -C "$REPO_DIR" fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
  else
    log "[DRY-RUN] Would fetch $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  fi

  merge_target="$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  log "Merging $merge_target into $current_branch"
  if [[ "$DRY_RUN" != "true" ]]; then
    if ! git -C "$REPO_DIR" merge --no-ff --no-edit "$merge_target"; then
      err "Merge conflict detected. Aborting merge."
      generate_conflict_report
      git -C "$REPO_DIR" status --short
      git -C "$REPO_DIR" merge --abort || true
      err "Backups are safe in: $BACKUP_DIR"
      exit 2
    fi
  else
    log "[DRY-RUN] Would merge $merge_target into $current_branch"
  fi

  if [[ "$DRY_RUN" != "true" ]]; then
    restore_local_file ".env"
    restore_local_file "plexus.yaml"
    restore_local_file "start-plexus.sh"
    restore_local_file "stop-plexus.sh"
    restore_local_file "config/plexus.yaml"
    
    # Validate restored files against checksum manifest
    if ! validate_post_restore_checksums; then
      err "=========================================="
      err "RESTORE VALIDATION FAILED"
      err "=========================================="
      err "Restored files do not match pre-merge checksums"
      err "Backup directory with valid state: $BACKUP_DIR"
      exit 4
    fi
    
    # Validate DATABASE_URL invariant after restore
    if ! validate_database_url_invariant; then
      err "=========================================="
      err "DATABASE_URL INVARIANT BREACH"
      err "=========================================="
      err "The DATABASE_URL in the restored .env does not match the expected value"
      err "This indicates a potential misconfiguration or security issue"
      exit 5
    fi
  else
    log "[DRY-RUN] Would restore local config files from backup"
    log "[DRY-RUN] Would validate restored files against checksum manifest"
    log "[DRY-RUN] Would validate DATABASE_URL invariant"
  fi

  if [[ "$DRY_RUN" != "true" ]]; then
    {
      echo "timestamp=$TS"
      echo "repo=$REPO_DIR"
      echo "branch=$current_branch"
      echo "merge_target=$merge_target"
      echo "head=$(git -C "$REPO_DIR" rev-parse HEAD)"
      echo "upstream=$(git -C "$REPO_DIR" rev-parse "$merge_target")"
      echo "dry_run=$DRY_RUN"
      echo "preserve_manifest=$MANIFEST_FILENAME"
    } > "$BACKUP_DIR/summary.txt"
  else
    log "[DRY-RUN] Would write summary to $BACKUP_DIR/summary.txt:"
    log "[DRY-RUN]   timestamp=$TS"
    log "[DRY-RUN]   repo=$REPO_DIR"
    log "[DRY-RUN]   branch=$current_branch"
    log "[DRY-RUN]   merge_target=$merge_target"
    log "[DRY-RUN]   head=$(git -C "$REPO_DIR" rev-parse HEAD)"
    log "[DRY-RUN]   upstream=$(git -C "$REPO_DIR" rev-parse "$merge_target")"
    log "[DRY-RUN]   dry_run=$DRY_RUN"
    log "[DRY-RUN]   preserve_manifest=$MANIFEST_FILENAME"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN COMPLETE] No mutations performed"
    log "[DRY-RUN] To apply changes, run without --dry-run flag"
  else
    log "Done."
  fi
  log "Backups: $BACKUP_DIR"
  log "Merge applied. Local custom config restored."
  log "Review changes with: git -C $REPO_DIR status --short"
  log "If needed, AI01 config archive: $BACKUP_DIR/ai01/config-files.tgz"
}

main "$@"
