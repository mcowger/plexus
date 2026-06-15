# Plexus Management MCP Server Plan

## Goal

Add an admin-only MCP server at `/mcp/plexus` that lets MCP clients manage Plexus itself.

Plexus already supports an MCP gateway at `/mcp/:name` for proxying to configured upstream MCP servers. The new `/mcp/plexus` path should be reserved for Plexus management and must not be treated as a configurable upstream MCP server name.

## Requirements

- Expose Plexus management actions through MCP tools.
- Gate every request with the `x-admin-key` header.
- Only the master admin key should authorize this MCP server.
- Do not accept regular inference API keys or Bearer tokens for `/mcp/plexus`.
- Reuse existing management services and validation where possible.
- Keep the MCP tool surface compact by using domain tools with an `operation` argument.
- Require `destructive: "acknowledged"` for destructive or high-impact operations.
- Redact secrets from normal tool responses.

## Route Architecture

Add a dedicated management MCP route module, likely:

- `packages/backend/src/routes/mcp/plexus.ts`
- optional support files under `packages/backend/src/services/plexus-mcp/`

Register `/mcp/plexus` before the existing dynamic MCP gateway route `/mcp/:name` in `packages/backend/src/routes/mcp/index.ts`.

Reserve `plexus` as a gateway server name. Creating or proxying a configured upstream MCP server named `plexus` should be rejected or ignored so it cannot collide with the management MCP server.

## Authentication

The `/mcp/plexus` path must require `x-admin-key` and admin privileges.

Reuse the existing management auth helpers where practical:

- `authenticate`
- `requireAdmin`
- `ManagementAuthError`

Expected behavior:

- Missing `x-admin-key`: 401
- Incorrect `x-admin-key`: 401
- Valid inference API key or Bearer token without admin key: 401
- Limited management principal: 403, if ever resolved through shared auth
- Valid admin key: allowed

The auth behavior should match the management API error shape as closely as possible.

## MCP Protocol Implementation

Use the official Model Context Protocol SDK. Do not implement a manual JSON-RPC MCP server.

The implementation should use the SDK-provided transport and server primitives for:

- initialization
- tool registration
- tool invocation
- resource registration
- prompt registration
- protocol error handling

HTTP methods to support:

- `POST /mcp/plexus` for JSON-RPC requests
- `GET /mcp/plexus` only if the selected MCP transport requires it
- `DELETE /mcp/plexus` only if the selected MCP transport requires session teardown

## Tool Design

Use compact domain tools with an `operation` argument instead of one tool per CRUD action.

General input shape:

```json
{
  "operation": "list | get | put | patch | delete | ...",
  "id": "optional-resource-id",
  "category": "optional-subdomain",
  "query": {},
  "body": {},
  "destructive": "acknowledged"
}
```

General success shape:

```json
{
  "ok": true,
  "operation": "list",
  "data": {}
}
```

General error shape:

```json
{
  "ok": false,
  "error": {
    "message": "...",
    "type": "...",
    "code": 400
  }
}
```

## Destructive Operation Rule

Every destructive or high-impact operation must require:

```json
{
  "destructive": "acknowledged"
}
```

If this argument is absent or not exactly `acknowledged`, reject the tool call with:

```json
{
  "ok": false,
  "error": {
    "message": "This destructive operation requires destructive: \"acknowledged\".",
    "type": "confirmation_required",
    "code": 400
  }
}
```

Operations requiring acknowledgement include:

- `delete`
- `delete_all`
- `clear`
- `clear_for_key`
- `quota_clear`
- `delete_log`
- `delete_all_logs`
- `restore`
- `restart`
- `rotate`
- `truncate`
- broad overwrite or import operations

Use a shared helper in the MCP implementation:

```ts
function requireDestructiveAck(input: { destructive?: string }) {
  if (input.destructive !== 'acknowledged') {
    throw new McpToolError(
      'This destructive operation requires destructive: "acknowledged".',
      'confirmation_required',
      400
    );
  }
}
```

## Recommended Tool Set

### `plexus_config`

Broad configuration inspection.

Operations:

- `get`
- `export`
- `status`

Normal responses should redact secrets. If an export operation can include secrets, make that behavior explicit and require `destructive: "acknowledged"` or another high-friction opt-in.

### `plexus_provider`

Manage providers and their model targets.

Operations:

- `list`
- `get`
- `put`
- `patch`
- `delete`
- `fetch_models`
- `quota_status`
- `quota_history`
- `quota_check`

Backed by existing provider CRUD, provider model discovery, and quota scheduler behavior.

Example:

```json
{
  "operation": "patch",
  "id": "openrouter",
  "body": {
    "enabled": false
  }
}
```

### `plexus_model_alias`

Manage model aliases, targets, and target groups.

Operations:

- `list`
- `get`
- `put`
- `patch`
- `delete`
- `delete_all`

Support alias fields including:

- `targets`
- `target_groups`
- selectors
- metadata
- model architecture
- preferred APIs
- advanced transforms

Example:

```json
{
  "operation": "patch",
  "id": "gpt-5",
  "body": {
    "target_groups": [
      {
        "name": "primary",
        "selector": "performance",
        "targets": [
          {
            "provider": "openrouter",
            "model": "openai/gpt-5",
            "enabled": true
          }
        ]
      }
    ]
  }
}
```

### `plexus_key`

Manage inference keys.

Operations:

- `list`
- `get`
- `put`
- `patch`
- `delete`
- `quota_status`
- `quota_clear`
- `rotate`, if key rotation is added or reused

Secrets must be redacted from list/get responses by default.

### `plexus_quota`

Manage user quota definitions and applied quota status for inference keys.

Operations:

- `list`
- `get`
- `put`
- `patch`
- `delete`
- `status_for_key`
- `clear_for_key`

Example:

```json
{
  "operation": "put",
  "id": "daily-dev",
  "body": {
    "type": "daily",
    "limitType": "requests",
    "limit": 1000
  }
}
```

### `plexus_quota_checker`

Manage and inspect upstream provider balance/quota checkers.

Operations:

- `types`
- `list`
- `get`
- `history`
- `check`

This is separate from `plexus_quota` because quota checkers represent upstream provider balance/usage checks, while user quotas represent Plexus inference-key enforcement.

### `plexus_usage`

Review request logs and summaries.

Operations:

- `list`
- `summary`
- `delete`
- `delete_all`

Example:

```json
{
  "operation": "list",
  "query": {
    "limit": 50,
    "provider": "openrouter",
    "sortBy": "date",
    "sortDir": "desc"
  }
}
```

### `plexus_debug`

Review debug traces and enable or disable debug tracing.

Operations:

- `state`
- `update`
- `logs`
- `get_log`
- `delete_log`
- `delete_all_logs`

Example:

```json
{
  "operation": "update",
  "body": {
    "enabled": true,
    "providers": ["openrouter"]
  }
}
```

### `plexus_mcp_gateway`

Manage Plexus' upstream MCP gateway configuration and MCP usage logs.

Operations:

- `servers_list`
- `server_put`
- `server_delete`
- `logs`
- `delete_log`
- `delete_all_logs`

### `plexus_settings`

Read and update general Plexus settings.

Use `operation` plus `category` to avoid an overly large operation enum.

Operations:

- `get`
- `patch`

Categories:

- `all`
- `failover`
- `exploration`
- `background_exploration`
- `cooldown`
- `timeout`
- `stall`
- `trusted_proxies`
- `vision_fallthrough`

Example:

```json
{
  "operation": "patch",
  "category": "timeout",
  "body": {
    "defaultSeconds": 300
  }
}
```

### `plexus_operations`

High-impact operational actions.

Operations:

- `backup`
- `restore`
- `restart`
- `list_cooldowns`
- `clear_cooldowns`

Destructive operations must require `destructive: "acknowledged"`.

Example:

```json
{
  "operation": "restore",
  "body": {
    "backup": {}
  },
  "destructive": "acknowledged"
}
```

### `plexus_system_logs`

Access Plexus system logs.

Operations:

- `recent`
- `stream`, later if MCP transport/client support is practical

Initial implementation should add or reuse a bounded in-memory log ring buffer around `logEmitter` and expose recent logs through `recent`.

## Service Reuse

Prefer direct service calls over making HTTP requests back into Plexus.

Use existing services:

- `ConfigService`
- `ConfigRepository`
- `UsageStorageService`
- `McpUsageStorageService`
- `QuotaScheduler`
- `QuotaEnforcer`
- `DebugManager`
- `CooldownManager`
- `logEmitter`

Use existing Zod schemas where possible:

- `ProviderConfigSchema`
- `ModelConfigSchema`
- `KeyConfigSchema`
- `McpServerConfigSchema`
- `QuotaDefinitionSchema`

When existing route modules contain important merge or validation behavior, extract shared helpers instead of duplicating logic in the MCP handlers.

## Handler Structure

Implement a dispatch table by tool name:

```ts
const handlers = {
  plexus_config: handleConfigTool,
  plexus_provider: handleProviderTool,
  plexus_model_alias: handleModelAliasTool,
  plexus_key: handleKeyTool,
  plexus_quota: handleQuotaTool,
  plexus_quota_checker: handleQuotaCheckerTool,
  plexus_usage: handleUsageTool,
  plexus_debug: handleDebugTool,
  plexus_mcp_gateway: handleMcpGatewayTool,
  plexus_settings: handleSettingsTool,
  plexus_operations: handleOperationsTool,
  plexus_system_logs: handleSystemLogsTool,
};
```

Each handler should validate:

- base input shape
- allowed operation
- required fields for the selected operation
- required `category`, if applicable
- destructive acknowledgement, if applicable
- domain-specific schema validation

## Secret Redaction

Normal MCP tool responses should redact or omit sensitive fields, including:

- provider API keys
- provider headers containing credentials
- MCP upstream headers containing credentials
- inference key secrets
- OAuth tokens
- quota checker tokens, cookies, sessions, and API keys
- backup/restore payload secrets unless explicitly requested by a high-friction operation

Use a shared redaction helper so all tools behave consistently.

The only exception is when the user has specific authorization for secret-bearing output and the MCP client explicitly sends `redact: false` for that operation. Even then, the operation should be narrowly scoped, audited in logs without recording the secret values, and rejected unless the handler explicitly supports unredacted output.

Generic list/get operations should continue to redact secrets by default.

## Prompt Resources

Include an appropriate MCP prompt resource that explains how to interact with Plexus management through this server.

The prompt should describe:

- what Plexus is
- what `/mcp/plexus` can manage
- the compact tool design using `operation`, `id`, `category`, `query`, and `body`
- the `destructive: "acknowledged"` requirement
- secret redaction defaults and the narrow `redact: false` exception
- best practices for safe changes
- recommended inspection-before-mutation workflows
- examples for common tasks like reviewing logs, updating a provider, editing an alias target group, checking quotas, and enabling debug tracing

The prompt should be registered with the official MCP SDK alongside tools and resources so compatible clients can discover it.

## Pagination and Limits

List-style operations should support:

- `limit`
- `offset`
- relevant filters
- relevant sorting options

Impose safe maximum limits, for example 500 records, to avoid very large MCP responses.

## Documentation

Add user-facing documentation for the management MCP endpoint after implementation.

Documentation should include:

- endpoint: `/mcp/plexus`
- required auth header: `x-admin-key`
- compact tool list
- operation names
- destructive acknowledgement rule
- client configuration examples
- warning that this endpoint grants admin-level control over Plexus

## Test Plan

Because implementation will write tests, load the `vitest` skill before editing tests.

Suggested test file:

- `packages/backend/src/routes/mcp/__tests__/plexus-mcp-routes.test.ts`

Coverage:

- rejects missing `x-admin-key`
- rejects wrong `x-admin-key`
- rejects regular API key or Bearer-only auth
- accepts correct admin key
- `/mcp/plexus` is handled by management MCP, not gateway proxy
- gateway route `/mcp/:name` still works for other server names
- configured upstream MCP server named `plexus` is rejected or cannot shadow management MCP
- `tools/list` returns the compact domain tool set
- `tools/call` dispatches to the correct handler
- read-only tools return expected data
- destructive tools reject without `destructive: "acknowledged"`
- destructive tools allow with acknowledgement
- provider/key/alias/quota CRUD updates `ConfigService`
- secrets are redacted from normal responses
- malformed operation inputs produce useful errors

Verification commands:

```bash
bun run test
bun run typecheck
```

If OpenAPI or documentation tooling is touched, also run:

```bash
bun run lint:openapi
```

## Implementation Phases

### Phase 1: Foundation

- Add `/mcp/plexus` route.
- Add admin-only `x-admin-key` auth.
- Implement `initialize`, `tools/list`, and `tools/call`.
- Add compact tool dispatch table.
- Implement first read-only operations:
  - `plexus_config get`
  - `plexus_provider list`
  - `plexus_model_alias list`
  - `plexus_key list`, redacted
  - `plexus_usage list`
  - `plexus_debug state`

### Phase 2: CRUD Management

- Implement provider CRUD.
- Implement model alias CRUD.
- Implement key CRUD.
- Implement quota CRUD.
- Implement MCP gateway server management.
- Implement settings get/patch by category.

### Phase 3: Observability and Operations

- Implement debug log operations.
- Implement usage deletion operations.
- Implement quota checker status/history/check operations.
- Implement MCP gateway log operations.
- Implement backup/restore/restart/cooldown operations.
- Add recent system log support.

### Phase 4: Hardening

- Audit all secret redaction.
- Enforce maximum response sizes.
- Add destructive acknowledgement checks everywhere needed.
- Add route collision tests.
- Add documentation and client examples.
- Run tests and type checking.
