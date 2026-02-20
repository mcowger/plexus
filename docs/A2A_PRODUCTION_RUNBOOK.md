# A2A Production Runbook (AI01)

This runbook documents what was implemented, what was hardened, how to validate, and how to deploy/rollback on AI01.

## Scope Delivered

- Full A2A server support under `/a2a/*` and agent card endpoints.
- Metrics route replacement: `/ui/metrics` now serves the A2A Console.
- Live Metrics remains available at `/ui/live-metrics`.
- New Live Metrics panel: `Model Pulse` under `Provider Pulse`.
- Enterprise hardening for A2A behavior and operations.

## Key Implementation Areas

### Backend

- A2A route handlers and contract responses:
  - `packages/backend/src/routes/a2a/index.ts`
- A2A task/state/event service:
  - `packages/backend/src/services/a2a/a2a-service.ts`
- A2A push delivery worker:
  - `packages/backend/src/services/a2a/a2a-push-delivery.ts`
- Server wiring/start-stop:
  - `packages/backend/src/index.ts`

### Database

- A2A schema tables (sqlite/postgres):
  - `packages/backend/drizzle/schema/sqlite/a2a.ts`
  - `packages/backend/drizzle/schema/postgres/a2a.ts`
- Ownership + hardening migrations:
  - `packages/backend/drizzle/migrations/0016_superb_malcolm_colcord.sql`
  - `packages/backend/drizzle/migrations_pg/0016_polite_frog_thor.sql`

### Frontend

- A2A Console page:
  - `packages/frontend/src/pages/A2AConsole.tsx`
- A2A API client and SSE behavior:
  - `packages/frontend/src/lib/api.ts`
- Navigation/route wiring:
  - `packages/frontend/src/App.tsx`
  - `packages/frontend/src/components/layout/Sidebar.tsx`
- Live Metrics model pulse:
  - `packages/frontend/src/pages/LiveMetrics.tsx`

## Hardening Implemented

- Per-key ownership scoping for A2A tasks and push configs.
- Scoped idempotency keys by owner key.
- A2A request version enforcement (`0.3`/`0.3.0`) with explicit errors.
- Request payload validation for task send endpoint.
- Route-level rate limiting with headers and bounded in-memory buckets.
- SSE stream safety improvements and reconnect behavior fixes.
- Push queue bounded depth to prevent unbounded memory growth.
- Push auth at-rest encryption envelope (`enc:v1:*`) with decrypt-on-read.
- Frontend stream behavior fix: stop reconnect loops after terminal task states.

## Known/Expected UI Behavior

- Old tasks (including canceled) remain visible because task history is persisted in DB.
- A2A Console stream status now closes for terminal tasks instead of reconnecting forever.

## Validation Checklist

### Local/CI-style

- LSP diagnostics clean on modified files.
- Backend tests:
  - `cd packages/backend && bun test`
- Frontend build:
  - `cd packages/frontend && bun run build`
- Compile bundle:
  - `bun run compile:linux`

### AI01 test container (`4101`)

- Build test image:
  - `localhost/thearchitectit-plexus:a2a-test`
- Start test container with required mounts/env:
  - `DATABASE_URL=sqlite:///app/data/usage.sqlite`
  - `/home/user001/plexus/plexus.yaml:/app/config/plexus.yaml:ro`
  - `plexus-a2a-test-data:/app/data`
- Verify:
  - `/ui/metrics`, `/ui/live-metrics`, `/v1/models`, `/.well-known/agent-card.json`
  - A2A send/get/list/cancel
  - push config create/list/get/delete
  - invalid version -> `400`
  - invalid body -> `400`
  - burst rate limit -> `429`

## Production Deployment (AI01, port `4001`)

1. Backup running image tag:

```bash
ssh user001@100.96.49.42 'TS=$(date +%Y%m%d-%H%M%S); CURRENT_ID=$(sudo podman inspect plexus --format "{{.Image}}"); sudo podman tag "$CURRENT_ID" "localhost/thearchitectit-plexus:pre-a2a-$TS"'
```

2. Promote tested image:

```bash
ssh user001@100.96.49.42 'sudo podman tag localhost/thearchitectit-plexus:a2a-test localhost/thearchitectit-plexus:latest'
```

3. Restart production container:

```bash
ssh user001@100.96.49.42 'cd ~/plexus && ./stop-plexus.sh && ./start-plexus.sh'
```

4. Smoke-check production:

```bash
ssh user001@100.96.49.42 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/ui/metrics'
ssh user001@100.96.49.42 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/ui/live-metrics'
ssh user001@100.96.49.42 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4001/v1/models'
```

## Rollback

If a cutover fails, retag the saved backup back to latest and restart:

```bash
ssh user001@100.96.49.42 'sudo podman tag localhost/thearchitectit-plexus:pre-a2a-<timestamp> localhost/thearchitectit-plexus:latest'
ssh user001@100.96.49.42 'cd ~/plexus && ./stop-plexus.sh && ./start-plexus.sh'
```
