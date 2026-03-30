#!/usr/bin/env bash
# test-startup-binary.sh
# Smoke-test the compiled Linux binary: verify it starts, serves /health, and loads /ui/.
#
# Usage: bash scripts/test-startup-binary.sh
# Expected working directory: repository root (where plexus-linux lives after compile:linux)
set -euo pipefail

ADMIN_KEY="test-startup-key-ci"
PORT=14000
TIMEOUT=60
BINARY_WORKDIR="packages/backend"
BINARY_NAME="plexus-linux"
LOG_FILE="/tmp/plexus-binary-startup.log"

echo "=== Binary Startup Test ==="

# ------------------------------------------------------------------
# Cleanup: kill background process and remove temp binary copy
# ------------------------------------------------------------------
cleanup() {
  if [[ -n "${PID:-}" ]]; then
    echo "Stopping binary (PID=$PID)..."
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "${BINARY_WORKDIR}/${BINARY_NAME}"
}
trap cleanup EXIT

# ------------------------------------------------------------------
# Stage binary in the backend package directory so that the static
# file path ../frontend/dist resolves to packages/frontend/dist.
# ------------------------------------------------------------------
if [[ ! -f "./${BINARY_NAME}" ]]; then
  echo "ERROR: ./${BINARY_NAME} not found. Run 'bun run compile:linux' first."
  exit 1
fi

cp "./${BINARY_NAME}" "${BINARY_WORKDIR}/${BINARY_NAME}"
chmod +x "${BINARY_WORKDIR}/${BINARY_NAME}"

# ------------------------------------------------------------------
# Start the binary
# ------------------------------------------------------------------
echo "Starting binary from ${BINARY_WORKDIR}/..."
pushd "${BINARY_WORKDIR}" >/dev/null
DATABASE_URL="sqlite://:memory:" \
  ADMIN_KEY="${ADMIN_KEY}" \
  PORT="${PORT}" \
  LOG_LEVEL="info" \
  "./${BINARY_NAME}" > "${LOG_FILE}" 2>&1 &
PID=$!
popd >/dev/null
echo "Binary PID: ${PID}"

# ------------------------------------------------------------------
# Wait for the "Server starting on port" log line
# ------------------------------------------------------------------
echo "Waiting for server to start (timeout: ${TIMEOUT}s)..."
STARTED=0
for i in $(seq 1 "${TIMEOUT}"); do
  if grep -q "Server starting on port" "${LOG_FILE}" 2>/dev/null; then
    echo "Server ready (detected after ~${i}s)"
    STARTED=1
    break
  fi
  if ! kill -0 "${PID}" 2>/dev/null; then
    echo "ERROR: Binary exited prematurely after ${i}s"
    echo "=== Log output ==="
    cat "${LOG_FILE}"
    exit 1
  fi
  sleep 1
done

if [[ "${STARTED}" -eq 0 ]]; then
  echo "ERROR: Server did not log readiness within ${TIMEOUT}s"
  echo "=== Log output ==="
  cat "${LOG_FILE}"
  exit 1
fi

# Brief pause to ensure the TCP port is fully accepting connections
sleep 1

# ------------------------------------------------------------------
# Test /health
# ------------------------------------------------------------------
echo "Testing GET /health ..."
HEALTH_RESPONSE=$(curl -sf --max-time 10 "http://localhost:${PORT}/health" || echo "CURL_FAILED")
if [[ "${HEALTH_RESPONSE}" != "OK" ]]; then
  echo "ERROR: /health returned unexpected response: '${HEALTH_RESPONSE}'"
  echo "=== Log output ==="
  cat "${LOG_FILE}"
  exit 1
fi
echo "  /health -> OK"

# ------------------------------------------------------------------
# Test /ui/ returns HTTP 200 with HTML content
# ------------------------------------------------------------------
echo "Testing GET /ui/ ..."
HTTP_CODE=$(curl -s --max-time 10 -o /tmp/plexus-binary-ui.html -w "%{http_code}" \
  "http://localhost:${PORT}/ui/")
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "ERROR: /ui/ returned HTTP ${HTTP_CODE}"
  echo "=== Response body ==="
  cat /tmp/plexus-binary-ui.html 2>/dev/null || true
  echo "=== Log output ==="
  cat "${LOG_FILE}"
  exit 1
fi
if ! grep -qi "<html\|<!doctype" /tmp/plexus-binary-ui.html 2>/dev/null; then
  echo "ERROR: /ui/ response does not appear to be HTML"
  echo "=== Response body (first 512 bytes) ==="
  head -c 512 /tmp/plexus-binary-ui.html
  echo "=== Log output ==="
  cat "${LOG_FILE}"
  exit 1
fi
echo "  /ui/ -> HTTP ${HTTP_CODE} (HTML confirmed)"

echo ""
echo "Binary startup test PASSED"
