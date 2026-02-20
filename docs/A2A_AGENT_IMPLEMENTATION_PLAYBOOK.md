# A2A Implementation Playbook for Agents

This document is the execution guide for implementing full A2A support in Plexus and replacing the current `Metrics` page with an A2A console.

It is written as a step-by-step runbook so any agent can continue the work without missing context.

---

## 1) Scope and Target Outcome

Build full A2A support directly inside the existing backend/frontend services (no second daemon in the same image), then expose it in the UI by replacing `Metrics` with an A2A console.

### In scope
- A2A protocol foundation (agent card/discovery, task lifecycle, streaming updates, cancellation, errors, auth behavior).
- Backend data model + persistence for A2A tasks/events.
- Frontend A2A console at the current Metrics navigation slot.
- AI01 deployment and health verification.

### Out of scope
- Removing or rewriting MCP support.
- Replacing `Live Metrics` (`/live-metrics`) which stays as-is.
- Splitting A2A into a separate service/container during this rollout.

---

## 2) Current Codebase Baseline (Verified)

### Existing route wiring
- `packages/frontend/src/App.tsx`
  - Contains current `Metrics` route and `LiveMetrics` route.
- `packages/frontend/src/components/layout/Sidebar.tsx`
  - Contains current nav item for `Metrics`.

### Existing protocol infrastructure
- `packages/backend/src/routes/mcp/index.ts`
  - MCP proxy endpoints and SSE behavior patterns.
- `packages/backend/src/services/mcp-proxy/mcp-proxy-service.ts`
  - Upstream proxy flow and JSON-RPC method extraction patterns.

### Existing backend startup/route registration
- `packages/backend/src/index.ts`
  - Main registration point for inference, MCP, management routes.

### Existing DB schema exports
- `packages/backend/drizzle/schema/sqlite/index.ts`
- `packages/backend/drizzle/schema/postgres/index.ts`

These files must be used as integration anchors during implementation.

---

## 3) Global Execution Rules (All Sprints)

1. Keep MCP behavior backward-compatible.
2. Use feature flags for A2A UI/API exposure until hardening completes.
3. Never edit existing migration SQL files manually.
4. For schema changes, generate both sqlite and postgres migrations.
5. Each sprint must end with:
   - Type/lint/diagnostics clean
   - Relevant tests passing
   - Frontend build passing
   - Root compile passing
   - AI01 deploy verification passing (for release checkpoints)

---

## 4) Definition of Done (Per Sprint)

A sprint is done only when all are true:
- Code implemented for sprint scope.
- Acceptance criteria checked.
- Test evidence captured in sprint notes.
- No regression in MCP routes/UI.
- Documentation updated (this playbook + API docs if endpoint behavior changed).

---

## 5) Sprint Plan (2-week cadence, 8 sprints)

## Sprint 0 - Protocol Freeze + Architecture

### Goal
Freeze the exact A2A contract to implement and define architecture decisions.

### Steps
1. Lock protocol version and create a single source of truth in docs:
   - Required operations
   - Task lifecycle semantics
   - Error contract
   - Discovery/card endpoint contract
2. Decide canonical endpoint names and route prefixes (no ambiguity).
3. Write ADRs for:
   - Storage model
   - Streaming model
   - Auth model
   - Idempotency behavior
4. Define compatibility boundary with MCP.
5. Create backlog tickets for Sprints 1-8 with acceptance criteria.

### Deliverables
- Protocol contract doc (version-pinned).
- ADR bundle.
- Groomed implementation backlog.

### Acceptance
- Team sign-off on frozen contract.
- No unresolved endpoint naming questions.

---

## Sprint 1 - Data and Domain Foundation

### Goal
Introduce A2A domain types and persistent schema.

### Steps
1. Add backend A2A type definitions:
   - Create `packages/backend/src/types/a2a.ts`.
2. Add schema files (sqlite + postgres):
   - Agents table
   - Tasks table
   - Task events table
   - Artifacts storage shape (JSON or relational, per ADR)
   - Idempotency key handling
3. Export new schema modules in:
   - `packages/backend/drizzle/schema/sqlite/index.ts`
   - `packages/backend/drizzle/schema/postgres/index.ts`
4. Generate migrations for both dialects:
   - `cd packages/backend && bunx drizzle-kit generate`
   - `cd packages/backend && bunx drizzle-kit generate --config drizzle.config.pg.ts`
5. Create repository/storage layer for A2A entities.
6. Add unit tests for storage CRUD + state persistence.

### Deliverables
- New A2A schema + migrations.
- A2A type layer.
- Storage tests passing.

### Acceptance
- Migrations apply cleanly on startup.
- CRUD and lookup tests pass for tasks and agents.

---

## Sprint 2 - Core A2A API (Non-streaming)

### Goal
Ship minimal but compliant non-streaming A2A backend operations.

### Steps
1. Create A2A route module:
   - `packages/backend/src/routes/a2a/index.ts`
2. Register A2A routes in `packages/backend/src/index.ts`.
3. Implement endpoints for:
   - agent card/discovery
   - create/send task
   - get task
   - cancel task
   - list/search tasks (if in contract)
4. Add request/response validation and strict error mapping.
5. Integrate auth hook patterns already used in MCP/management routes.
6. Add idempotency key behavior for task creation.
7. Add integration tests for all non-streaming endpoints.

### Deliverables
- A2A backend route slice registered and test-covered.

### Acceptance
- Endpoints return contract-valid payloads.
- Idempotency duplicate submission behavior is deterministic.

---

## Sprint 3 - Task State Machine and Lifecycle Guarantees

### Goal
Make lifecycle transitions robust and race-safe.

### Steps
1. Build explicit state machine transitions in service layer:
   - `submitted -> working -> completed/failed/canceled`
   - optional `input-required` / `auth-required` per contract.
2. Enforce terminal-state guards.
3. Add cancellation concurrency protections.
4. Persist event history for state transitions.
5. Add tests for:
   - legal and illegal transitions
   - duplicate cancel
   - race conditions
   - retries and timeout outcomes

### Deliverables
- Deterministic lifecycle engine with complete tests.

### Acceptance
- Transition matrix is fully covered by tests.
- No task can move out of terminal state.

---

## Sprint 4 - Streaming + Notification Model

### Goal
Deliver real-time task update capabilities.

### Steps
1. Implement streaming endpoint(s) using SSE patterns from MCP routes.
2. Emit structured task events for each state/artifact update.
3. Implement disconnect/reconnect handling and cursor/replay strategy.
4. Add optional push notification integration with retries/backoff.
5. Add load tests for event throughput.
6. Add integration tests for stream lifecycle.

### Deliverables
- Real-time task stream support with tested event contract.

### Acceptance
- Stream clients receive ordered updates.
- Disconnect/reconnect behavior is validated.

---

## Sprint 5 - Frontend A2A Console (Metrics Replacement)

### Goal
Replace Metrics tab UX with an A2A console while preserving Live Metrics.

### Steps
1. Create new page:
   - `packages/frontend/src/pages/A2AConsole.tsx`
2. Update route wiring in `packages/frontend/src/App.tsx`:
   - Replace current `Metrics` component mapping with A2A console.
3. Update sidebar nav in `packages/frontend/src/components/layout/Sidebar.tsx`:
   - Change Metrics label/icon to A2A Console entry.
4. Keep `/live-metrics` and `LiveMetrics` untouched.
5. Add frontend API client methods in `packages/frontend/src/lib/api.ts` for A2A endpoints.
6. Build UI sections:
   - Agent registry/list
   - Task creation panel
   - Task status/detail view
   - Real-time event viewer
7. Add frontend tests for basic flows.

### Deliverables
- A2A console replacing Metrics page route.

### Acceptance
- User can register/select agents, submit tasks, view status/events from UI.

---

## Sprint 6 - MCP Interop Bridge

### Goal
Allow practical mixed operation with existing MCP infrastructure.

### Steps
1. Define and implement A2A <-> MCP mapping layer.
2. Support A2A-initiated operations using MCP-backed capabilities where configured.
3. Translate error models across boundaries.
4. Add management visibility for interop links.
5. Add E2E tests for mixed A2A/MCP workflows.

### Deliverables
- Interop bridge with guardrails.

### Acceptance
- Mixed flow scenarios pass.
- Existing MCP features remain intact.

---

## Sprint 7 - Compliance, Security, and Performance Hardening

### Goal
Make implementation production-grade.

### Steps
1. Execute full conformance checklist against locked protocol contract.
2. Security hardening:
   - auth scheme enforcement
   - secret handling
   - webhook verification/signing
   - abuse/rate controls
3. Performance and soak tests under realistic load.
4. Instrumentation and SLO dashboards for A2A path.
5. Fix defects and close all critical findings.

### Deliverables
- Conformance report.
- Security review report.
- Performance benchmark report.

### Acceptance
- No open critical security/compliance issues.
- SLO targets achieved.

---

## Sprint 8 - Rollout, Runbooks, and Cutover

### Goal
Safely release to production and complete operational handoff.

### Steps
1. Deploy to AI01 canary using existing podman flow.
2. Validate API and UI health checks.
3. Progressive rollout with rollback gates.
4. Publish operator runbooks and support docs.
5. Post-release monitoring + bug bash window.

### Deliverables
- Production rollout complete.
- Handoff package complete.

### Acceptance
- Stable production behavior over monitoring window.
- Rollback tested and documented.

---

## 6) Agent Checklist Template (Use for Every Sprint)

Copy this checklist into each sprint ticket and mark items explicitly.

### Design and Scope
- [ ] Scope matches sprint goal exactly.
- [ ] No out-of-scope expansion.
- [ ] Contract changes are reviewed and documented.

### Implementation
- [ ] Files created/updated as listed.
- [ ] Backward compatibility checks completed.
- [ ] Feature flag behavior verified (if enabled).

### Verification
- [ ] `lsp_diagnostics` clean for modified files.
- [ ] Backend tests added/updated and passing.
- [ ] Frontend build passing.
- [ ] Root compile passing.

### Deployment (release checkpoints)
- [ ] Sync source to AI01 `~/plexus-src-live`.
- [ ] `sudo podman build` success.
- [ ] image tagged to `localhost/thearchitectit-plexus:latest`.
- [ ] restart via `~/plexus/stop-plexus.sh` and `~/plexus/start-plexus.sh`.
- [ ] health checks return HTTP 200.

### Documentation
- [ ] This playbook updated for new decisions.
- [ ] API docs updated for new/changed routes.

---

## 7) Standard Verification Commands

Run from repo root unless noted.

```bash
# frontend build
cd packages/frontend && bun run build

# full compile
cd ../.. && bun run compile:linux

# backend tests (broad)
cd packages/backend && bun test
```

If running frontend build and full compile in the same run, run them sequentially (not in parallel) to avoid transient build race issues.

---

## 8) AI01 Deployment Runbook (Canonical)

```bash
# ensure destination exists
ssh user001@100.96.49.42 "mkdir -p ~/plexus-src-live"

# sync source
rsync -az --delete --exclude ".git" --exclude "node_modules" --exclude "dist" --exclude ".worktrees" \
  "/mnt/ollama/git/plexus/plexus/" "user001@100.96.49.42:~/plexus-src-live/"

# build and restart on AI01
ssh user001@100.96.49.42 "cd ~/plexus-src-live && sudo podman build -t plexus:live-metrics-local . && sudo podman tag plexus:live-metrics-local localhost/thearchitectit-plexus:latest && cd ~/plexus && ./stop-plexus.sh && ./start-plexus.sh"

# verify
ssh user001@100.96.49.42 "sudo podman ps --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/ui/metrics %{http_code}\n' http://127.0.0.1:4001/ui/metrics"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/ui/live-metrics %{http_code}\n' http://127.0.0.1:4001/ui/live-metrics"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/v1/models %{http_code}\n' http://127.0.0.1:4001/v1/models"
```

---

## 9) Risk Register (Track Every Sprint)

1. Protocol drift risk
   - Mitigation: keep version lock and contract tests.
2. State transition bugs
   - Mitigation: explicit transition matrix tests.
3. Streaming instability under load
   - Mitigation: soak tests + replay/cursor strategy.
4. MCP compatibility regressions
   - Mitigation: regression suite for MCP routes/UI.
5. Deployment surprises on AI01
   - Mitigation: repeatable podman runbook and health checks.

---

## 10) Handoff Format (Required in Every PR/Merge Request)

Use this exact structure in PR description or deployment notes:

1. Scope completed (ticket IDs)
2. Files changed
3. Tests run + results
4. Contract changes (if any)
5. Deployment evidence (if deployed)
6. Risks/open items for next sprint

---

## 11) Immediate Next Action

Start Sprint 0 and produce two artifacts first:
- `docs/A2A_PROTOCOL_CONTRACT.md`
- `docs/A2A_ARCHITECTURE_ADRS.md`

Do not start schema or route implementation until those two documents are approved.
