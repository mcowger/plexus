# MCP Proxy Design Plan for Plexus

## 1. Goal and Scope

Add a **remote HTTP MCP proxy** capability to Plexus so operators can define named upstream MCP servers in `plexus.yaml` and expose each server on its own isolated endpoint:

- Upstream config example: `https://mcp-a.com/mcp`
- Local exposed endpoint example: `https://plexusserver/mcp/mcpa`

Primary goals:
- Minimal/no translation of MCP JSON-RPC payloads (transparent pass-through)
- Plexus API-key auth in front of every MCP endpoint
- Per-server URL isolation (no shared tool namespace pollution)
- Streamable HTTP support (modern MCP transport): POST + GET + DELETE
- Support resources + tools + basic connection lifecycle (initialize/initialized)
- Support arbitrary configured upstream headers

Out of scope for this phase:
- OAuth client flows in Plexus MCP proxy
- Sampling, elicitation, tasks-specific features
- Rewriting/normalizing tool/resource payloads

---

## 2. Research Summary (Spec + SDK)

This plan follows MCP spec + TypeScript SDK behavior:

1. **Transport**
   - Streamable HTTP MCP endpoint supports **POST** for JSON-RPC messages, optional **GET** SSE channel, and **DELETE** for session termination.
   - Client and server can exchange requests/notifications/responses over this channel model.

2. **Lifecycle**
   - `initialize` handshake first, then `notifications/initialized`.
   - Capability negotiation is end-to-end concern; proxy should avoid altering capability payloads.

3. **Sessioning**
   - `MCP-Session-Id` can be returned by upstream and must be included on subsequent requests by client.
   - Proxy must preserve and manage session continuity safely.

4. **Headers**
   - `MCP-Protocol-Version` should pass through.
   - SSE/event headers and MCP session headers should be preserved.

5. **Security**
   - Proxy should not pass through Plexus client token as upstream token.
   - Keep upstream auth as independently configured static headers.
   - Forward all non-hop-by-hop headers only where intended.

---

## 3. Confirmed Product Decisions

From your decisions:

- Transport: **Streamable HTTP only**
- Session strategy: **Stateful sessions**
- Upstream auth: **Static headers in config**
- Header policy: **Allow all headers** (with standard hop-by-hop filtering)
- URL restrictions: **No allowlist/denylist restrictions**
- Mapping: **1:1 base URL** (`/mcp/:name` only)
- Config source of truth: **`plexus.yaml` only**
- Client auth to Plexus: **reuse existing API key auth**
- Method handling: **transparent pass-through for all JSON-RPC methods**
- Logging: **dedicated MCP metadata + MCP debug tables**
- Name constraints: **slug-safe** (`[a-z0-9][a-z0-9-_]{1,62}`)
- Upstream URL scheme: **allow `http://` and `https://`**
- Validation: **pass-through JSON-RPC** (no strict schema validation)
- CORS: **off by default** for MCP endpoints
- Protocol version: **pass through client `MCP-Protocol-Version`**
- Response header forwarding: **all except hop-by-hop**

---

## 4. Proposed Architecture

## 4.1 High-level Flow

1. Client calls `POST|GET|DELETE|PATCH /mcp/:name` with Plexus API key.
2. Plexus authenticates using existing bearer key strategy from inference routes.
3. Plexus resolves `:name` in MCP server config.
4. Plexus constructs upstream request to configured `upstream_url`.
5. Plexus forwards:
   - Request body as-is (for POST)
   - Supported headers (all minus hop-by-hop)
   - Static configured upstream headers (merged in)
   - Session/version headers as applicable
6. Plexus returns upstream status/body/stream nearly unchanged.
7. Plexus records metadata row in MCP usage table; stores full request/response only when debug tracing is enabled.

## 4.2 New Backend Components

- `packages/backend/src/routes/mcp/index.ts`
  - Registers `/mcp/:name` handlers for POST, GET, DELETE, PATCH.
  - Contains auth hook reuse + route dispatch.

- `packages/backend/src/services/mcp-proxy/`
  - `mcp-router.ts`: resolve config by name
  - `mcp-session-store.ts`: map local<->upstream session state if needed
  - `mcp-proxy-service.ts`: request forwarding, header filtering, SSE handling
  - `mcp-usage-storage.ts`: DB persistence for metadata + debug

- `packages/backend/src/types/mcp.ts`
  - Config/runtime types for MCP server entries and usage records.

- Optional utility:
  - `packages/backend/src/utils/http-headers.ts` for reusable hop-by-hop filtering.

---

## 5. Configuration Design (`plexus.yaml`)

Add a top-level section:

```yaml
mcp_servers:
  mcpa:
    upstream_url: "https://mcp-a.com/mcp"
    enabled: true
    headers:
      Authorization: "Bearer upstream-secret"
      X-Org: "my-org"
      X-Project: "alpha"
```

Rules:
- Key (`mcpa`) must match slug-safe regex.
- `upstream_url` required, `http` or `https`.
- `enabled` default `true`.
- `headers` optional map of string->string; arbitrary keys allowed.

Config schema updates in `packages/backend/src/config.ts`:
- Add `McpServerConfigSchema`
- Add optional `mcpServers: z.record(...)` to raw config schema
- Export inferred `McpServerConfig` type
- Ensure `loadConfig()` and hot-reload include this section

Management API behavior:
- No separate CRUD API required initially.
- Existing `/v0/management/config` remains the edit mechanism (source of truth).

---

## 6. Endpoint Contract

Expose exactly:
- `POST /mcp/:name`
- `GET /mcp/:name`
- `DELETE /mcp/:name`

No `/mcp/:name/*` subpath forwarding in phase 1.

### 6.1 Authentication

Use same API-key auth as inference routes:
- Reuse existing methods where possible - avoid duplication.
- Accept `Authorization: Bearer ...`
- Accept `x-api-key` and normalize similarly
- Track keyName + attribution if provided

### 6.2 Header Forwarding

Forward request headers to upstream except hop-by-hop headers (e.g., `connection`, `keep-alive`, `transfer-encoding`, etc.).

Merge with configured static upstream headers:
- Static headers should override client-provided duplicates for deterministic upstream auth.

Pass through MCP-specific headers:
- `MCP-Session-Id`
- `MCP-Protocol-Version`
- `Last-Event-ID` (for GET resume)

Response headers:
- Forward all upstream response headers except hop-by-hop.
- Preserve `MCP-Session-Id`, `Content-Type`, SSE-relevant fields.

### 6.3 Body/Method Handling

- POST: forward raw JSON body as-is.
- GET: establish/pass through SSE stream from upstream.
- DELETE: forward to upstream for session termination.

No JSON-RPC structural validation in proxy.

---

## 7. Session Handling Strategy

Because this is a transparent HTTP proxy (not MCP SDK bridge), session behavior can remain header-centric:

- If upstream returns `MCP-Session-Id`, proxy forwards it to client unchanged.
- Client includes that header in future requests; proxy forwards upstream.
- For GET resumability, proxy forwards `Last-Event-ID`.

No mandatory server-side session translation layer is required for v1 unless operational issues appear.

Future-safe hook:
- Keep optional in-memory session registry for observability/debug correlation (not protocol translation).

---

## 8. Database & Observability Design

You requested dedicated MCP tables with metadata-only defaults + full debug when tracing is enabled.

## 8.1 New Tables

Add in both SQLite and Postgres schema sets:

1. `mcp_request_usage`
   - `request_id` (unique)
   - `created_at`, `start_time`, `duration_ms`
   - `server_name`
   - `upstream_url` (or hashed/redacted variant)
   - `method` (POST/GET/DELETE)
   - `jsonrpc_method` (best-effort extraction for POST body)
   - `api_key` (logical key name, not secret)
   - `attribution`
   - `source_ip`
   - `response_status`
   - `is_streamed`
   - `has_debug`
   - `error_code` #if relvent
   - `error_message`

2. `mcp_debug_logs`
   - `id`
   - `request_id`
   - `raw_request_headers`
   - `raw_request_body`
   - `raw_response_headers`
   - `raw_response_body`
   - `created_at`

Behavior:
- Always write metadata row to `mcp_request_usage`.
- Only write `mcp_debug_logs` when debug tracing is enabled.

## 8.2 Migration Workflow (strict)

Follow existing project rules exactly:
1. Edit schema files in both:
   - `packages/backend/drizzle/schema/sqlite/`
   - `packages/backend/drizzle/schema/postgres/`
2. Generate migrations for both DBs:
   - `bunx drizzle-kit generate`
   - `bunx drizzle-kit generate --config drizzle.config.pg.ts`
3. Review generated SQL + journals.
4. Restart server and validate migration apply.

Do not manually create/edit migration files.

## 8.3 Type Exports

Update `packages/backend/src/db/types.ts` with inferred types for new MCP tables.

---

## 9. Error Handling Model

- Unknown server name: `404` with structured error.
- Disabled server: `403` or `404` (recommend `404` to avoid information leakage).
- Missing/invalid Plexus auth: `401` consistent with existing style.
- Upstream timeout/network failures: `502` / `504` mapped consistently.
- Upstream non-2xx: pass through status + body when safe.

No rewriting of JSON-RPC error payloads except for transport-level failures where upstream response is absent.

---

## 10. Security Posture (per chosen defaults)

Given your choices:
- Allowing all headers and unrestricted upstream URLs increases flexibility; this is intentional.
- Keep core safeguards:
  - strip hop-by-hop headers
  - never forward Plexus API key.
  - avoid logging secrets in metadata table
  - redact sensitive headers in debug logs optionally (recommended default: redact `authorization`, `cookie`, `set-cookie`)

Even with unrestricted URLs, this remains controllable because only trusted operators can edit `plexus.yaml`.

---

## 11. Testing Plan

### 11.1 Unit Tests

1. Config schema tests
   - Valid/invalid `mcpServers` entries
   - slug name validation
   - header map acceptance

2. Header forwarding tests
   - hop-by-hop stripped
   - static headers override client header collisions
   - MCP headers pass through

3. Error mapping tests
   - unknown `:name`
   - disabled server
   - upstream unavailable

### 11.2 Integration Tests (Fastify inject + mocked upstream)

1. POST proxy pass-through
   - body unchanged
   - status/body passthrough
2. GET SSE proxying
   - event stream continuity
   - `Last-Event-ID` forwarding
3. DELETE session pass-through
4. Auth behavior parity with inference key model
5. Metadata logging inserted
6. Debug tracing toggles full payload logging


---

## 12. Implementation Phases

### Phase 1: Config + Route Skeleton
- Add config schema + types for `mcpServers`
- Register `/mcp/:name` routes
- Reuse existing auth pattern

### Phase 2: Core Proxy Forwarding
- Implement POST/GET/DELETE forwarding
- Add header filtering and static header merge
- Preserve status + headers + body/stream

### Phase 3: MCP Observability
- Add dedicated schema tables + migrations (sqlite+postgres)
- Add storage service + write metadata rows
- Add debug log persistence under debug mode

### Phase 4: Test Coverage + Hardening
- Unit + integration tests
- Redaction and timeout defaults
- Final docs update (README/config examples)

---

## 13. File-Level Change Plan (Expected)

Backend config/routing/services:
- `packages/backend/src/config.ts`
- `packages/backend/src/index.ts`
- `packages/backend/src/routes/mcp/index.ts` (new)
- `packages/backend/src/services/mcp-proxy/mcp-proxy-service.ts` (new)
- `packages/backend/src/services/mcp-proxy/mcp-usage-storage.ts` (new)
- `packages/backend/src/types/mcp.ts` (new)
- `packages/backend/src/db/types.ts`

Drizzle schema:
- `packages/backend/drizzle/schema/sqlite/mcp-request-usage.ts` (new)
- `packages/backend/drizzle/schema/sqlite/mcp-debug-logs.ts` (new)
- `packages/backend/drizzle/schema/sqlite/index.ts`
- `packages/backend/drizzle/schema/postgres/mcp-request-usage.ts` (new)
- `packages/backend/drizzle/schema/postgres/mcp-debug-logs.ts` (new)
- `packages/backend/drizzle/schema/postgres/index.ts`

Generated migrations (auto-generated, both dialects):
- `packages/backend/drizzle/migrations/*`
- `packages/backend/drizzle/migrations_pg/*`

Tests:
- `packages/backend/src/routes/mcp/__tests__/*` (new)
- config and storage tests as needed


