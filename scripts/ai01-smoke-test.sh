#!/usr/bin/env bash
set -euo pipefail

# AI01 Smoke Test Script
# Post-deploy health validation for Plexus on AI01
#
# Usage: ./ai01-smoke-test.sh [--verbose]
#
# Validates:
#   - Container exists/running
#   - /v1/models endpoint returns HTTP 200 with valid JSON
#   - DATABASE_URL env var exists and has expected prefix
#   - Recent logs contain no critical startup/migration errors

VERBOSE=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    *) ;;
  esac
done

# Configuration defaults (override via environment variables)
AI01_SSH="${AI01_SSH:-user001@100.96.49.42}"
PLEXUS_CONTAINER="${PLEXUS_CONTAINER:-plexus}"
PLEXUS_BASE_URL="${PLEXUS_BASE_URL:-http://localhost:4001}"
PLEXUS_URL="${PLEXUS_URL:-${PLEXUS_BASE_URL}/v1/models}"
LOG_LINES="${LOG_LINES:-50}"

# Expected patterns
DATABASE_URL_PREFIX="${DATABASE_URL_PREFIX:-postgresql://}"
EXPECTED_APP_VERSION_PREFIX="${EXPECTED_APP_VERSION_PREFIX:-}"

# Critical error signatures to scan for in logs
declare -a CRITICAL_PATTERNS=(
  "Migration failed"
  "Failed to initialize database"
  "panic"
  "FATAL"
  "ERROR.*database"
  "Connection refused"
  "ECONNREFUSED"
  "unhandled.*exception"
  "TypeError.*cannot read"
  "SyntaxError"
)

# Track results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
declare -a CHECK_RESULTS=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err() { printf '[ERROR] %s\n' "$*" >&2; }

verbose() {
  if [[ "$VERBOSE" == "true" ]]; then
    printf '[DEBUG] %s\n' "$*"
  fi
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

# Mask sensitive values in output
mask_secret() {
  local value="$1"
  local prefix="${value:0:20}"
  local suffix="${value: -8}"
  if [[ ${#value} -gt 40 ]]; then
    echo "${prefix}...${suffix}"
  else
    echo "${value:0:20}..."
  fi
}

# Execute SSH command on AI01
ai01_exec() {
  ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$AI01_SSH" "$@"
}

# Record check result
record_check() {
  local name="$1"
  local status="$2"  # PASS or FAIL
  local details="${3:-}"

  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

  if [[ "$status" == "PASS" ]]; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    printf '[PASS] %s' "$name"
    [[ -n "$details" ]] && printf ': %s' "$details"
    printf '\n'
  else
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    printf '[FAIL] %s' "$name"
    [[ -n "$details" ]] && printf ': %s' "$details"
    printf '\n'
  fi

  CHECK_RESULTS+=("$status|$name|$details")
}

# Check 1: Container exists and is running
check_container_running() {
  verbose "Checking container status for: $PLEXUS_CONTAINER"

  local container_info
  if ! container_info=$(ai01_exec "sudo podman ps --filter name=$PLEXUS_CONTAINER --format '{{.ID}}|{{.Status}}|{{.Names}}'" 2>/dev/null); then
    record_check "Container Running" "FAIL" "SSH command failed"
    return 1
  fi

  verbose "Container info: $container_info"

  if [[ -z "$container_info" ]]; then
    # Check if container exists but is not running
    local all_containers
    all_containers=$(ai01_exec "sudo podman ps -a --filter name=$PLEXUS_CONTAINER --format '{{.ID}}|{{.Status}}|{{.Names}}'" 2>/dev/null || true)

    if [[ -n "$all_containers" ]]; then
      record_check "Container Running" "FAIL" "Container exists but is not running"
    else
      record_check "Container Running" "FAIL" "Container does not exist"
    fi
    return 1
  fi

  # Check if status contains "Up"
  if echo "$container_info" | grep -q "Up"; then
    record_check "Container Running" "PASS" "Container is healthy"
    return 0
  else
    local status
    status=$(echo "$container_info" | cut -d'|' -f2)
    record_check "Container Running" "FAIL" "Container status: $status"
    return 1
  fi
}

# Check 2: Models endpoint returns HTTP 200
check_models_endpoint() {
  verbose "Checking models endpoint: $PLEXUS_URL"

  local response
  local http_code
  local curl_exit

  # Execute curl via SSH on AI01
  response=$(ai01_exec "curl -s -w '\\nHTTP_CODE:%{http_code}' --max-time 10 --retry 2 --retry-delay 1 '$PLEXUS_URL'" 2>/dev/null) || curl_exit=$?

  if [[ ${curl_exit:-0} -ne 0 ]]; then
    record_check "Models Endpoint" "FAIL" "curl failed (exit $curl_exit)"
    return 1
  fi

  # Extract HTTP code
  http_code=$(echo "$response" | grep -o 'HTTP_CODE:[0-9]*' | cut -d':' -f2)
  verbose "HTTP response code: $http_code"

  if [[ "$http_code" != "200" ]]; then
    record_check "Models Endpoint" "FAIL" "HTTP $http_code (expected 200)"
    return 1
  fi

  # Extract body (everything before HTTP_CODE line)
  local body
  body=$(echo "$response" | sed -n '1,/HTTP_CODE:/p' | sed '$d')
  verbose "Response body: ${body:0:200}..."

  # Store for next check
  MODELS_RESPONSE="$body"
  record_check "Models Endpoint" "PASS" "HTTP 200"
  return 0
}

# Check 3: Response JSON structure
check_response_json() {
  verbose "Validating JSON response structure"

  if [[ -z "${MODELS_RESPONSE:-}" ]]; then
    record_check "JSON Structure" "FAIL" "No response data from previous check"
    return 1
  fi

  # Check if response is valid JSON
  if ! echo "$MODELS_RESPONSE" | ai01_exec 'python3 -m json.tool >/dev/null 2>&1'; then
    # Try checking locally
    if ! echo "$MODELS_RESPONSE" | python3 -m json.tool >/dev/null 2>&1; then
      record_check "JSON Structure" "FAIL" "Response is not valid JSON"
      return 1
    fi
  fi

  verbose "Response is valid JSON"

  # Check for object=list field
  if ! echo "$MODELS_RESPONSE" | grep -q '"object".*"list"'; then
    record_check "JSON Structure" "FAIL" "Missing 'object=list' field"
    return 1
  fi

  verbose "Found 'object=list' field"

  # Check for data array
  if ! echo "$MODELS_RESPONSE" | grep -q '"data"'; then
    record_check "JSON Structure" "FAIL" "Missing 'data' field"
    return 1
  fi

  verbose "Found 'data' field"

  record_check "JSON Structure" "PASS" "object=list, data array present"
  return 0
}

# Check 4: DATABASE_URL environment variable
check_database_url() {
  verbose "Checking DATABASE_URL environment variable"

  local db_url
  if ! db_url=$(ai01_exec "sudo podman inspect --format='{{range .Config.Env}}{{println .}}{{end}}' $PLEXUS_CONTAINER | grep '^DATABASE_URL='" 2>/dev/null); then
    record_check "DATABASE_URL Env" "FAIL" "Failed to inspect container"
    return 1
  fi

  if [[ -z "$db_url" ]]; then
    record_check "DATABASE_URL Env" "FAIL" "DATABASE_URL not set in container"
    return 1
  fi

  # Extract value (remove DATABASE_URL= prefix)
  db_url="${db_url#DATABASE_URL=}"

  verbose "DATABASE_URL found: $(mask_secret "$db_url")"

  # Check prefix
  if [[ "$db_url" != "$DATABASE_URL_PREFIX"* ]]; then
    record_check "DATABASE_URL Env" "FAIL" "Does not start with '$DATABASE_URL_PREFIX'"
    return 1
  fi

  record_check "DATABASE_URL Env" "PASS" "Set with expected prefix"
  return 0
}

# Check 5: Log scan for critical errors
check_logs_for_errors() {
  verbose "Scanning last $LOG_LINES lines for critical errors"

  local logs
  if ! logs=$(ai01_exec "sudo podman logs --tail=$LOG_LINES $PLEXUS_CONTAINER 2>&1" 2>/dev/null); then
    record_check "Log Scan" "FAIL" "Failed to retrieve logs"
    return 1
  fi

  verbose "Retrieved ${#logs} characters of log data"

  local found_errors=()
  local pattern

  for pattern in "${CRITICAL_PATTERNS[@]}"; do
    if echo "$logs" | grep -qiE "$pattern"; then
      found_errors+=("$pattern")
      verbose "Found error pattern: $pattern"
    fi
  done

  if [[ ${#found_errors[@]} -gt 0 ]]; then
    local error_list
    error_list=$(IFS=', '; echo "${found_errors[*]}")
    record_check "Log Scan" "FAIL" "Found signatures: $error_list"
    return 1
  fi

  record_check "Log Scan" "PASS" "No critical errors in last $LOG_LINES lines"
  return 0
}

# Check 6: Build metadata endpoint returns HTTP 200 with non-empty version
check_build_endpoint() {
  local build_url="${PLEXUS_BASE_URL}/v0/management/build"
  verbose "Checking build endpoint: $build_url"

  local response
  local http_code
  local curl_exit

  # Execute curl via SSH on AI01
  response=$(ai01_exec "curl -s -w '\\nHTTP_CODE:%{http_code}' --max-time 10 --retry 2 --retry-delay 1 '$build_url'" 2>/dev/null) || curl_exit=$?

  if [[ ${curl_exit:-0} -ne 0 ]]; then
    record_check "Build Endpoint" "FAIL" "curl failed (exit $curl_exit)"
    return 1
  fi

  # Extract HTTP code
  http_code=$(echo "$response" | grep -o 'HTTP_CODE:[0-9]*' | cut -d':' -f2)
  verbose "HTTP response code: $http_code"

  if [[ "$http_code" != "200" ]]; then
    record_check "Build Endpoint" "FAIL" "HTTP $http_code (expected 200)"
    return 1
  fi

  # Extract body (everything before HTTP_CODE line)
  local body
  body=$(echo "$response" | sed -n '1,/HTTP_CODE:/p' | sed '$d')
  verbose "Response body: ${body:0:200}..."

  # Parse version from JSON
  local version
  version=$(echo "$body" | ai01_exec 'python3 -c "import sys, json; print(json.load(sys.stdin).get(\"version\", \"\"))"' 2>/dev/null)
  
  if [[ -z "$version" ]]; then
    version=$(echo "$body" | python3 -c 'import sys, json; print(json.load(sys.stdin).get("version", ""))' 2>/dev/null || true)
  fi

  if [[ -z "$version" ]]; then
    record_check "Build Endpoint" "FAIL" "Missing or empty version field"
    return 1
  fi

  verbose "Build version: $version"

  # Check version prefix if configured
  if [[ -n "$EXPECTED_APP_VERSION_PREFIX" ]]; then
    if [[ "$version" != "$EXPECTED_APP_VERSION_PREFIX"* ]]; then
      record_check "Build Endpoint" "FAIL" "Version '$version' does not start with '$EXPECTED_APP_VERSION_PREFIX'"
      return 1
    fi
    record_check "Build Endpoint" "PASS" "HTTP 200, version: $version (prefix match)"
  else
    record_check "Build Endpoint" "PASS" "HTTP 200, version: $version"
  fi
  return 0
}

# Check 7: A2A endpoint returns HTTP 200
check_a2a_endpoint() {
  local a2a_url="${PLEXUS_BASE_URL}/.well-known/agent-card.json"
  verbose "Checking A2A endpoint: $a2a_url"

  local response
  local http_code
  local curl_exit

  # Execute curl via SSH on AI01
  response=$(ai01_exec "curl -s -w '\\nHTTP_CODE:%{http_code}' --max-time 10 --retry 2 --retry-delay 1 '$a2a_url'" 2>/dev/null) || curl_exit=$?

  if [[ ${curl_exit:-0} -ne 0 ]]; then
    record_check "A2A Endpoint" "FAIL" "curl failed (exit $curl_exit)"
    return 1
  fi

  # Extract HTTP code
  http_code=$(echo "$response" | grep -o 'HTTP_CODE:[0-9]*' | cut -d':' -f2)
  verbose "HTTP response code: $http_code"

  if [[ "$http_code" != "200" ]]; then
    record_check "A2A Endpoint" "FAIL" "HTTP $http_code (expected 200)"
    return 1
  fi

  record_check "A2A Endpoint" "PASS" "HTTP 200"
  return 0
}

# Check 8: Detailed metrics endpoint returns HTTP 200
check_metrics_endpoint() {
  local metrics_url="${PLEXUS_BASE_URL}/v0/management/usage/summary?range=day"
  verbose "Checking metrics endpoint: $metrics_url"

  local response
  local http_code
  local curl_exit

  # Execute curl via SSH on AI01
  response=$(ai01_exec "curl -s -w '\\nHTTP_CODE:%{http_code}' --max-time 10 --retry 2 --retry-delay 1 '$metrics_url'" 2>/dev/null) || curl_exit=$?

  if [[ ${curl_exit:-0} -ne 0 ]]; then
    record_check "Metrics Endpoint" "FAIL" "curl failed (exit $curl_exit)"
    return 1
  fi

  # Extract HTTP code
  http_code=$(echo "$response" | grep -o 'HTTP_CODE:[0-9]*' | cut -d':' -f2)
  verbose "HTTP response code: $http_code"

  if [[ "$http_code" != "200" ]]; then
    record_check "Metrics Endpoint" "FAIL" "HTTP $http_code (expected 200)"
    return 1
  fi

  record_check "Metrics Endpoint" "PASS" "HTTP 200"
  return 0
}

check_config_write_path() {
  verbose "Checking config path atomic rewrite capability"

  local check_output
  if ! check_output=$(ai01_exec "sudo podman exec $PLEXUS_CONTAINER sh -lc 'set -e; test -f /app/config/plexus.yaml; cp /app/config/plexus.yaml /app/config/.plexus-write-check; mv /app/config/.plexus-write-check /app/config/plexus.yaml'" 2>&1); then
    record_check "Config Write Path" "FAIL" "Atomic rewrite failed"
    verbose "Config write check error: $check_output"
    return 1
  fi

  record_check "Config Write Path" "PASS" "Atomic config rewrite works"
  return 0
}

# Print final summary
print_summary() {
  echo ""
  echo "=========================================="
  echo "SMOKE TEST SUMMARY"
  echo "=========================================="
  echo "Target: $AI01_SSH"
  echo "Container: $PLEXUS_CONTAINER"
  echo "Endpoint: $PLEXUS_URL"
  echo ""
  echo "Total Checks: $TOTAL_CHECKS"
  echo "  Passed: $PASSED_CHECKS"
  echo "  Failed: $FAILED_CHECKS"
  echo "=========================================="

  if [[ $FAILED_CHECKS -eq 0 ]]; then
    echo "RESULT: ALL CHECKS PASSED"
    return 0
  else
    echo "RESULT: SOME CHECKS FAILED"
    return 1
  fi
}

main() {
  log "AI01 Smoke Test Starting"
  log "SSH Target: $AI01_SSH"
  log "Container: $PLEXUS_CONTAINER"
  log "URL: $PLEXUS_URL"
  log "Verbose: $VERBOSE"
  log "Expected Version Prefix: ${EXPECTED_APP_VERSION_PREFIX:-<not set>}"
  echo ""

  # Preflight checks
  need_cmd ssh
  # Note: podman is only required on remote host (AI01), not locally

  # Test SSH connectivity
  log "Testing SSH connectivity..."
  if ! ai01_exec "echo 'SSH OK'" >/dev/null 2>&1; then
    err "Cannot reach AI01 via SSH: $AI01_SSH"
    err "Check network, host key, or credentials"
    exit 1
  fi
  log "SSH connectivity confirmed"
  echo ""

  # Run all checks
  check_container_running || true
  check_models_endpoint || true
  check_response_json || true
  check_database_url || true
  check_logs_for_errors || true
  check_build_endpoint || true
  check_a2a_endpoint || true
  check_metrics_endpoint || true
  check_config_write_path || true

  # Print summary
  print_summary
  exit $?
}

main "$@"
