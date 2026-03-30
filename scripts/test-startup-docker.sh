#!/usr/bin/env bash
# test-startup-docker.sh
# Smoke-test the Docker image: verify it starts, serves /health, and loads /ui/.
#
# Usage: bash scripts/test-startup-docker.sh [image-tag]
# Expected working directory: repository root
# Default image tag: plexus-test:latest
set -euo pipefail

IMAGE="${1:-plexus-test:latest}"
ADMIN_KEY="test-startup-key-ci"
HOST_PORT=14001
CONTAINER_PORT=4000
TIMEOUT=60
CONTAINER_NAME="plexus-startup-test-$$"

echo "=== Docker Startup Test (${IMAGE}) ==="

# ------------------------------------------------------------------
# Cleanup: always stop and remove the test container
# ------------------------------------------------------------------
cleanup() {
  if docker inspect "${CONTAINER_NAME}" &>/dev/null; then
    echo "Stopping container ${CONTAINER_NAME}..."
    docker stop "${CONTAINER_NAME}" 2>/dev/null || true
    docker rm  "${CONTAINER_NAME}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------
# Start the container with an in-memory SQLite database so no
# persistent volume is required.
# ------------------------------------------------------------------
echo "Starting container..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -e "ADMIN_KEY=${ADMIN_KEY}" \
  -e "DATABASE_URL=sqlite://:memory:" \
  -e "LOG_LEVEL=info" \
  "${IMAGE}"

echo "Container started: ${CONTAINER_NAME}"

# ------------------------------------------------------------------
# Wait for the "Server starting on port" log line
# ------------------------------------------------------------------
echo "Waiting for server to start (timeout: ${TIMEOUT}s)..."
STARTED=0
for i in $(seq 1 "${TIMEOUT}"); do
  if docker logs "${CONTAINER_NAME}" 2>&1 | grep -q "Server starting on port"; then
    echo "Server ready (detected after ~${i}s)"
    STARTED=1
    break
  fi
  # Check if the container is still running
  STATUS=$(docker inspect --format='{{.State.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "missing")
  if [[ "${STATUS}" != "running" ]]; then
    echo "ERROR: Container stopped unexpectedly after ${i}s (status=${STATUS})"
    echo "=== Container logs ==="
    docker logs "${CONTAINER_NAME}" 2>&1 || true
    exit 1
  fi
  sleep 1
done

if [[ "${STARTED}" -eq 0 ]]; then
  echo "ERROR: Server did not log readiness within ${TIMEOUT}s"
  echo "=== Container logs ==="
  docker logs "${CONTAINER_NAME}" 2>&1 || true
  exit 1
fi

# Brief pause to ensure the TCP port is fully accepting connections
sleep 1

# ------------------------------------------------------------------
# Test /health
# ------------------------------------------------------------------
echo "Testing GET /health ..."
HEALTH_RESPONSE=$(curl -sf --max-time 10 "http://localhost:${HOST_PORT}/health" || echo "CURL_FAILED")
if [[ "${HEALTH_RESPONSE}" != "OK" ]]; then
  echo "ERROR: /health returned unexpected response: '${HEALTH_RESPONSE}'"
  echo "=== Container logs ==="
  docker logs "${CONTAINER_NAME}" 2>&1 || true
  exit 1
fi
echo "  /health -> OK"

# ------------------------------------------------------------------
# Test /ui/ returns HTTP 200 with HTML content
# ------------------------------------------------------------------
echo "Testing GET /ui/ ..."
HTTP_CODE=$(curl -s --max-time 10 -o /tmp/plexus-docker-ui.html -w "%{http_code}" \
  "http://localhost:${HOST_PORT}/ui/")
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "ERROR: /ui/ returned HTTP ${HTTP_CODE}"
  echo "=== Response body ==="
  cat /tmp/plexus-docker-ui.html 2>/dev/null || true
  echo "=== Container logs ==="
  docker logs "${CONTAINER_NAME}" 2>&1 || true
  exit 1
fi
if ! grep -qi "<html\|<!doctype" /tmp/plexus-docker-ui.html 2>/dev/null; then
  echo "ERROR: /ui/ response does not appear to be HTML"
  echo "=== Response body (first 512 bytes) ==="
  head -c 512 /tmp/plexus-docker-ui.html
  echo "=== Container logs ==="
  docker logs "${CONTAINER_NAME}" 2>&1 || true
  exit 1
fi
echo "  /ui/ -> HTTP ${HTTP_CODE} (HTML confirmed)"

echo ""
echo "Docker startup test PASSED"
