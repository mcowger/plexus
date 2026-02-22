#!/usr/bin/env bash
set -euo pipefail

# Orchestrator for end-to-end gated flow: sync -> deploy -> smoke
#
# Usage: ./run-upstream-sync-and-deploy.sh [OPTIONS]
#
# Stages (executed in order):
#   1. sync   - Run update-from-upstream.sh
#   2. deploy - Run deploy-to-ai01.sh
#   3. smoke  - Run ai01-smoke-test.sh
#
# On failure of any non-dry-run stage, rollback is invoked automatically
# (unless disabled with --no-rollback).
#
# Options:
#   --dry-run      Log actions without executing mutations (passed to child scripts)
#   --skip-sync    Skip the sync stage
#   --skip-deploy  Skip the deploy stage
#   --skip-smoke   Skip the smoke test stage
#   --no-rollback  Disable automatic rollback on failure
#   --help         Show this help message and exit

# Option flags
DRY_RUN=false
SKIP_SYNC=false
SKIP_DEPLOY=false
SKIP_SMOKE=false
NO_ROLLBACK=false

# Stage results tracking
declare -a STAGE_RESULTS=()
OVERALL_STATUS="PENDING"
START_TIME=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

show_help() {
  cat << 'EOF'
Usage: run-upstream-sync-and-deploy.sh [OPTIONS]

Orchestrator for end-to-end gated flow: sync -> deploy -> smoke

Stages (executed in order):
  1. sync   - Run update-from-upstream.sh
  2. deploy - Run deploy-to-ai01.sh
  3. smoke  - Run ai01-smoke-test.sh

On failure of any non-dry-run stage, rollback is invoked automatically
(unless disabled with --no-rollback).

Options:
  --dry-run       Log actions without executing mutations
  --skip-sync     Skip the sync stage
  --skip-deploy   Skip the deploy stage
  --skip-smoke    Skip the smoke test stage
  --no-rollback   Disable automatic rollback on failure
  --help          Show this help message and exit

Exit Codes:
  0   All requested stages completed successfully
  1   One or more stages failed (and rollback may have been attempted)
  2   Configuration or preflight error

Examples:
  # Run full pipeline
  ./run-upstream-sync-and-deploy.sh

  # Dry-run to preview changes
  ./run-upstream-sync-and-deploy.sh --dry-run

  # Deploy only (skip sync)
  ./run-upstream-sync-and-deploy.sh --skip-sync

  # Sync and deploy without smoke test
  ./run-upstream-sync-and-deploy.sh --skip-smoke

  # Deploy with no rollback on failure
  ./run-upstream-sync-and-deploy.sh --skip-sync --no-rollback
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        shift
        ;;
      --skip-sync)
        SKIP_SYNC=true
        shift
        ;;
      --skip-deploy)
        SKIP_DEPLOY=true
        shift
        ;;
      --skip-smoke)
        SKIP_SMOKE=true
        shift
        ;;
      --no-rollback)
        NO_ROLLBACK=true
        shift
        ;;
      --help)
        show_help
        exit 0
        ;;
      *)
        err "Unknown option: $1"
        err "Use --help for usage information"
        exit 2
        ;;
    esac
  done
}

# Get current timestamp in seconds since epoch
get_timestamp() {
  date +%s
}

# Calculate elapsed time between two timestamps
calc_elapsed() {
  local start="$1"
  local end="$2"
  echo $((end - start))
}

# Format elapsed seconds as "Xs" or "Xm Xs"
format_elapsed() {
  local seconds="$1"
  if [[ $seconds -lt 60 ]]; then
    echo "${seconds}s"
  else
    local mins=$((seconds / 60))
    local secs=$((seconds % 60))
    echo "${mins}m ${secs}s"
  fi
}

# Record stage result
# Usage: record_stage stage_name command exit_code elapsed_seconds
record_stage() {
  local stage="$1"
  local cmd="$2"
  local exit_code="$3"
  local elapsed="$4"
  local result

  if [[ $exit_code -eq 0 ]]; then
    result="PASS"
  else
    result="FAIL"
  fi

  STAGE_RESULTS+=("$stage|$cmd|$result|$exit_code|$elapsed")
}

# Execute a stage with timing and logging
# Usage: run_stage stage_name command [args...]
# Returns: exit code of the command
run_stage() {
  local stage="$1"
  shift
  local cmd="$*"
  local start_ts end_ts elapsed

  log "=========================================="
  log "STAGE: $stage"
  log "COMMAND: $cmd"
  log "START: $(date '+%Y-%m-%d %H:%M:%S')"
  log "=========================================="

  start_ts=$(get_timestamp)
  local exit_code=0

  "$@" || exit_code=$?

  end_ts=$(get_timestamp)
  elapsed=$(calc_elapsed "$start_ts" "$end_ts")

  record_stage "$stage" "$cmd" "$exit_code" "$elapsed"

  if [[ $exit_code -eq 0 ]]; then
    log "STAGE RESULT: PASS ($stage)"
  else
    err "STAGE RESULT: FAIL ($stage)"
  fi
  log "ELAPSED: $(format_elapsed "$elapsed")"
  log ""

  return $exit_code
}

# Run sync stage
run_sync_stage() {
  local sync_script="$SCRIPT_DIR/update-from-upstream.sh"
  local args=()

  if [[ "$DRY_RUN" == "true" ]]; then
    args+=("--dry-run")
  fi

  if [[ ! -f "$sync_script" ]]; then
    err "Sync script not found: $sync_script"
    return 1
  fi

  run_stage "sync" "$sync_script" "${args[@]}"
}

# Run deploy stage
run_deploy_stage() {
  local deploy_script="$SCRIPT_DIR/deploy-to-ai01.sh"
  local args=()

  if [[ "$DRY_RUN" == "true" ]]; then
    args+=("--dry-run")
  fi

  if [[ ! -f "$deploy_script" ]]; then
    err "Deploy script not found: $deploy_script"
    return 1
  fi

  run_stage "deploy" "$deploy_script" "${args[@]}"
}

# Run smoke test stage
run_smoke_stage() {
  local smoke_script="$SCRIPT_DIR/ai01-smoke-test.sh"
  local args=("--verbose")

  # Smoke test script does not support --dry-run, it's read-only
  # But we still pass --verbose for detailed output

  if [[ ! -f "$smoke_script" ]]; then
    err "Smoke test script not found: $smoke_script"
    return 1
  fi

  run_stage "smoke" "$smoke_script" "${args[@]}"
}

# Invoke rollback on failure
invoke_rollback() {
  local failed_stage="$1"
  local rollback_script="$SCRIPT_DIR/ai01-rollback.sh"
  local rollback_result=0

  log "=========================================="
  log "ROLLBACK INVOKED"
  log "FAILED STAGE: $failed_stage"
  log "DRY RUN: $DRY_RUN"
  log "NO ROLLBACK: $NO_ROLLBACK"
  log "=========================================="

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[DRY-RUN] Would invoke rollback script"
    return 0
  fi

  if [[ "$NO_ROLLBACK" == "true" ]]; then
    log "Rollback disabled (--no-rollback flag set)"
    return 1
  fi

  if [[ ! -f "$rollback_script" ]]; then
    err "Rollback script not found: $rollback_script"
    return 1
  fi

  log "Executing rollback script..."

  if "$rollback_script"; then
    log "Rollback completed successfully"
    return 0
  else
    rollback_result=$?
    err "Rollback failed with exit code: $rollback_result"
    return $rollback_result
  fi
}

# Print final summary
print_summary() {
  local final_status="$1"
  local total_elapsed="$2"

  echo ""
  echo "=========================================="
  echo "ORCHESTRATOR SUMMARY"
  echo "=========================================="
  echo "Start Time: $START_TIME"
  echo "End Time: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Total Elapsed: $(format_elapsed "$total_elapsed")"
  echo "Dry Run: $DRY_RUN"
  echo ""
  echo "STAGE RESULTS:"
  echo "------------------------------------------"
  printf "%-10s %-8s %-6s %s\n" "STAGE" "RESULT" "TIME" "COMMAND"
  echo "------------------------------------------"

  local result
  for result in "${STAGE_RESULTS[@]}"; do
    local stage cmd status exit_code elapsed
    IFS='|' read -r stage cmd status exit_code elapsed <<< "$result"
    printf "%-10s %-8s %-6s %s\n" "$stage" "$status" "$(format_elapsed "$elapsed")" "$cmd"
  done

  echo "------------------------------------------"
  echo "OVERALL STATUS: $final_status"
  echo "=========================================="
}

main() {
  START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
  local start_ts end_ts total_elapsed
  start_ts=$(get_timestamp)

  # Preflight: required commands
  need_cmd date
  need_cmd printf
  need_cmd dirname
  need_cmd pwd

  # Parse arguments
  parse_args "$@"

  log "=========================================="
  log "ORCHESTRATOR STARTED"
  log "=========================================="
  log "Start Time: $START_TIME"
  log "Dry Run: $DRY_RUN"
  log "Skip Sync: $SKIP_SYNC"
  log "Skip Deploy: $SKIP_DEPLOY"
  log "Skip Smoke: $SKIP_SMOKE"
  log "No Rollback: $NO_ROLLBACK"
  log "=========================================="
  log ""

  # Track if any stage failed
  local failed_stage=""
  local final_exit=0

  # Stage 1: Sync
  if [[ "$SKIP_SYNC" != "true" ]]; then
    if ! run_sync_stage; then
      failed_stage="sync"
      final_exit=1
    fi
  else
    log "[SKIP] Sync stage skipped (--skip-sync)"
  fi

  # Stage 2: Deploy (only if sync succeeded or was skipped)
  if [[ -z "$failed_stage" && "$SKIP_DEPLOY" != "true" ]]; then
    if ! run_deploy_stage; then
      failed_stage="deploy"
      final_exit=1
    fi
  elif [[ -n "$failed_stage" ]]; then
    log "[SKIP] Deploy stage skipped (previous stage failed: $failed_stage)"
  else
    log "[SKIP] Deploy stage skipped (--skip-deploy)"
  fi

  # Stage 3: Smoke Test (only if deploy succeeded or was skipped)
  if [[ -z "$failed_stage" && "$SKIP_SMOKE" != "true" ]]; then
    if ! run_smoke_stage; then
      failed_stage="smoke"
      final_exit=1
    fi
  elif [[ -n "$failed_stage" ]]; then
    log "[SKIP] Smoke test stage skipped (previous stage failed: $failed_stage)"
  else
    log "[SKIP] Smoke test stage skipped (--skip-smoke)"
  fi

  # Handle failure with rollback
  if [[ -n "$failed_stage" ]]; then
    OVERALL_STATUS="FAILED ($failed_stage)"
    log ""
    log "=========================================="
    err "PIPELINE FAILED at stage: $failed_stage"
    log "=========================================="

    # Attempt rollback
    local rollback_status
    if invoke_rollback "$failed_stage"; then
      rollback_status="SUCCEEDED"
    else
      rollback_status="FAILED"
    fi

    log "Rollback Status: $rollback_status"

    if [[ "$rollback_status" == "SUCCEEDED" ]]; then
      OVERALL_STATUS="FAILED ($failed_stage, ROLLBACK SUCCEEDED)"
    else
      OVERALL_STATUS="FAILED ($failed_stage, ROLLBACK $rollback_status)"
    fi
  else
    OVERALL_STATUS="SUCCESS"
  fi

  # Calculate total elapsed time
  end_ts=$(get_timestamp)
  total_elapsed=$(calc_elapsed "$start_ts" "$end_ts")

  # Print final summary
  print_summary "$OVERALL_STATUS" "$total_elapsed"

  if [[ "$OVERALL_STATUS" == SUCCESS* ]]; then
    log "Pipeline completed successfully"
    exit 0
  else
    err "Pipeline failed - see summary above"
    exit 1
  fi
}

main "$@"
