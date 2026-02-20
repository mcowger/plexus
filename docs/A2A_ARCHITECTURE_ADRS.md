# A2A Architecture ADRs

Status: Accepted
Applies to: Plexus A2A rollout
Last updated: 2026-02-20

---

## ADR-0001: Implement A2A in the existing backend service

### Context
Plexus already has production auth, logging, DB lifecycle, and route registration in `packages/backend/src/index.ts`.

### Decision
Implement A2A as a new backend module in the existing service, not as a second daemon inside the same image.

### Consequences
- Faster delivery and less operational complexity.
- Shared middleware and observability.
- Future extraction into a separate service remains possible if scale/security needs demand it.

### Implementation anchor
- Add A2A route registration in `packages/backend/src/index.ts`.

---

## ADR-0002: Use HTTP+JSON/REST as primary A2A binding

### Context
A2A supports multiple bindings. We need one complete, testable binding first.

### Decision
Primary binding is REST under `/a2a/*` with the A2A contract endpoints.

### Consequences
- Clear path to compliance with lower complexity than multi-binding start.
- JSON-RPC binding may be added later for interoperability parity.

### Implementation anchor
- New module: `packages/backend/src/routes/a2a/index.ts`.

---

## ADR-0003: Keep discovery endpoint at well-known root

### Context
Agent card discovery is expected at a well-known location.

### Decision
Serve discovery card at `/.well-known/agent-card.json` and extended card at `/a2a/extendedAgentCard`.

### Consequences
- Works with default discovery clients.
- Keeps internal operational endpoints namespaced under `/a2a`.

---

## ADR-0004: Persist A2A entities in first-class DB schema

### Context
Task lifecycle, events, idempotency, and replay require durable storage.

### Decision
Create dedicated A2A schema files for sqlite and postgres and export from schema indexes.

### Consequences
- Reliable state transitions and auditability.
- Additional migration overhead.

### Implementation anchors
- `packages/backend/drizzle/schema/sqlite/*`
- `packages/backend/drizzle/schema/postgres/*`
- `packages/backend/drizzle/schema/sqlite/index.ts`
- `packages/backend/drizzle/schema/postgres/index.ts`

---

## ADR-0005: Model task lifecycle as strict state machine

### Context
Async operations and cancellation race conditions can corrupt task state without strict transition rules.

### Decision
Implement explicit allowed transitions and terminal state immutability.

### Consequences
- More deterministic behavior.
- Requires robust transition tests and clear error contract.

---

## ADR-0006: SSE is the primary streaming transport for v1

### Context
Existing code already uses SSE patterns in MCP routes.

### Decision
Use SSE for message stream and task subscription in v1.

### Consequences
- Reuse proven patterns and reduce risk.
- WebSocket support deferred.

### Implementation reference
- Pattern source: `packages/backend/src/routes/mcp/index.ts`.

---

## ADR-0007: Use idempotency keys on task/message creation

### Context
Retries from clients and network failures can duplicate long-running tasks.

### Decision
Support idempotency key semantics on send/create operations with conflict detection.

### Consequences
- Safe client retries.
- Must persist keys and enforce payload consistency checks.

---

## ADR-0008: Preserve MCP behavior and add adapter bridge later

### Context
Plexus already has active MCP users and routes.

### Decision
Do not alter MCP protocol contracts. Add A2A-to-MCP bridge as a dedicated interoperability layer in later sprint.

### Consequences
- Avoids regression risk.
- Requires separate translation logic and tests.

---

## ADR-0009: Replace Metrics route with A2A Console, keep Live Metrics

### Context
User explicitly requested replacing Metrics while keeping Live Metrics.

### Decision
Swap `/metrics` page implementation to A2A console and update sidebar label; leave `/live-metrics` unchanged.

### Consequences
- Navigation continuity for users (same slot in UI).
- Existing metrics page no longer primary UX.

### Implementation anchors
- `packages/frontend/src/App.tsx`
- `packages/frontend/src/components/layout/Sidebar.tsx`
- `packages/frontend/src/pages/A2AConsole.tsx` (new)

---

## ADR-0010: Deploy and validate only on AI01 runtime flow

### Context
Runtime constraint: container lifecycle is managed on AI01 with `sudo podman`.

### Decision
Use AI01 deployment runbook as canonical release validation path.

### Consequences
- Consistent release verification environment.
- Local container assumptions are non-authoritative.

### Operational runbook reference
- `docs/A2A_AGENT_IMPLEMENTATION_PLAYBOOK.md` section "AI01 Deployment Runbook (Canonical)".

---

## ADR-0011: Feature flag A2A UI/API until hardening complete

### Context
Large protocol rollout should not be exposed to all users during development.

### Decision
Gate A2A console and selected A2A operations behind feature flags until sprint hardening sign-off.

### Consequences
- Safer incremental rollout.
- Slight complexity in route/UI guard logic.

---

## ADR-0012: Compliance-first testing strategy

### Context
Protocol projects fail when behavior drifts from contract under edge conditions.

### Decision
Adopt contract-driven tests as release gate: endpoint semantics, lifecycle transitions, streaming behavior, auth, idempotency, and MCP regression coverage.

### Consequences
- Higher initial test investment.
- Lower production risk and easier interoperability validation.

---

## Change Control for ADRs

Any change to these ADRs requires:
1. updated ADR section,
2. migration/compatibility note,
3. test impact note,
4. approval in sprint planning.
