# MCP Server

Plexus exposes two MCP (Model Context Protocol) server endpoints:

1. **MCP Gateway** at `/mcp/:name` — proxies requests to configured upstream MCP servers.
2. **Plexus Management MCP** at `/mcp/plexus` — an admin-only MCP server for managing Plexus itself.

Both endpoints have independent controls. The Plexus Management MCP at `/mcp/plexus` can be disabled via the toggle on the MCP Servers page. When disabled, `/mcp/plexus` responds with HTTP 418; gateway servers (`/mcp/:name`) are unaffected.

## Authentication

### MCP Gateway (`/mcp/:name`)

The MCP Gateway requires an inference API key passed as a Bearer token or in the `x-api-key` header. Requests are authenticated against the same key store used by the Plexus inference API.

- Missing key → 401
- Invalid key → 401
- Valid key with route access → proxied to the upstream MCP server

### Plexus Management MCP (`/mcp/plexus`)

The management MCP requires the admin key in the `x-admin-key` header. Inference API keys and Bearer tokens are **not** accepted.

- Missing `x-admin-key` → 401
- Incorrect `x-admin-key` → 401
- Inference API key or Bearer token alone → 401
- Valid admin key → request processed

## MCP Gateway Commands

The gateway proxies all MCP protocol messages (JSON-RPC over HTTP POST, GET, DELETE) to the configured upstream server. It does not interpret or modify tool calls. Logs are recorded in the MCP usage storage and viewable in the MCP Logs page.

### Configuring Upstream Servers

Upstream MCP servers are configured on the MCP page. Each server requires:

- **Name** — slug-safe identifier used in the URL path
- **Upstream URL** — the upstream MCP server endpoint
- **Headers** — optional headers forwarded to the upstream server
- **Timeout** — request timeout in milliseconds

Plexus also supports **Local HTTP** MCP servers. For these, Plexus starts a
local process with either `bunx` or `uvx`, waits for it to listen on a local
HTTP port, then proxies `/mcp/:name` to `http://127.0.0.1:<port><path>`.
Admins select the launcher (`bunx` or `uvx`), provide a package name, package
arguments, environment variables, port, and path. Arbitrary commands are not supported.

Server names must match `[a-z0-9][a-z0-9-_]{1,62}`. The name `plexus` is reserved for the management MCP server and cannot be used as a gateway server name.

## Plexus Management MCP Tools

The management MCP server at `/mcp/plexus` provides domain-oriented tools for inspecting and managing Plexus configuration. Each tool uses an `operation` argument to select the action, keeping the tool surface compact.

### Input Shape

```json
{
  "operation": "list | get | ...",
  "id": "optional-resource-id",
  "category": "optional-settings-category",
  "query": {},
  "body": {},
  "destructive": "acknowledged"
}
```

### Destructive Operations

Destructive or high-impact operations (delete, restore, restart, rotate, etc.) require `"destructive": "acknowledged"`. If omitted, the tool call is rejected with a `confirmation_required` error.

### Secret Redaction

All normal responses redact sensitive fields (API keys, secrets, tokens, cookies, sessions, passwords). Secrets are replaced with `[REDACTED]`.

### Available Tools

| Tool | Operations | Description |
|------|-----------|-------------|
| `plexus_config` | `get`, `export`, `status` | Inspect full Plexus configuration or summary status. |
| `plexus_provider` | `list`, `get`, `put`, `create`, `update`, `delete`, `fetch_models` | Inspect and manage providers and routing configuration. |
| `plexus_model_alias` | `list`, `get`, `put`, `create`, `update`, `delete`, `delete_all` | Inspect and manage model aliases, targets, and target groups. |
| `plexus_key` | `list`, `get`, `put`, `create`, `update`, `delete` | Inspect and manage inference keys (secrets redacted). |
| `plexus_quota` | `list`, `get`, `put`, `create`, `update`, `delete` | Inspect and manage user quota definitions. |
| `plexus_quota_checker` | `types`, `list`, `get` | Inspect upstream quota checker configuration. |
| `plexus_usage` | `list`, `summary`, `delete`, `delete_all` | Review request logs and usage summaries; delete individual or bulk usage logs. |
| `plexus_debug` | `state`, `update`, `logs`, `get_log`, `delete_log`, `delete_all_logs` | Inspect and manage debug tracing and stored debug logs. |
| `plexus_mcp_gateway` | `servers_list`, `list`, `get`, `put`, `create`, `update`, `delete` | Inspect and manage upstream MCP gateway server configuration. |
| `plexus_settings` | `get` | Get settings by category (failover, cooldown, timeout, stall, exploration, etc.) |
| `plexus_system_logs` | `recent`, `level`, `set_level`, `reset_level` | Inspect recent in-memory Plexus system logs from the bounded ring buffer and control the runtime logging level. |
| `plexus_operations` | `backup`, `restore`, `restart`, `list_cooldowns`, `clear_cooldowns`, `reset_logs` | High-impact operational actions, backups/restores, cooldown inspection, and log resets. |

### Prompt Resource

The management MCP server registers a `plexus_management_guide` prompt that MCP clients can request. It describes Plexus, the tool design, destructive acknowledgement, secret redaction, and recommended workflows.

## Enabling / Disabling

The Plexus Management MCP can be toggled from the **MCP Servers** page. The "Plexus Management MCP" row at the top of the server list provides the toggle. When disabled, only `/mcp/plexus` responds with:

```
HTTP 418 I'm a teapot
{
  "error": {
    "message": "Plexus Management MCP is disabled. Enable it on the MCP Servers page.",
    "type": "mcp_disabled"
  }
}
```

The default state is **enabled**.
