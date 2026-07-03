---
name: plexus-management
description: Use this skill whenever the agent needs to inspect or administer a running Plexus instance through the management API, OR whenever debugging a bug/error/failure that touches Plexus-proxied traffic (oauth, provider routing, model targets, inference keys, MCP gateway, request/response handling) rather than searching the local codebase for it. This includes request logs, debug traces (including looking up a specific debug trace ID/UUID and any upstream error it recorded), enabling/disabling debug capture, providers and model targets, provider balances and quotas, model aliases and target groups, inference keys, user quotas, MCP gateway servers and logs, runtime settings such as failover, exploration, cooldowns, timeouts, stall detection, network restrictions, backup/restore, and system logs. Prefer this skill for any Plexus admin, operational, or live-debugging task, even if the user only says "check Plexus", "look at logs", "update a provider", "rotate keys", "configure quotas", "debug a request", "review debug trace <id>", "fix a bug in the oauth path", or "why did upstream return an error" — do not default to grep/find over the local repo for these; Plexus state lives behind the management API, not in local files.
---

# Plexus Management API

Use the Plexus management API through portable `curl` and `jq` commands. Do not assume local filesystem access to the Plexus data store when a management endpoint exists.

## First Steps

1. Require a base URL. Prefer `PLEXUS_STAGING_URL`; if absent, ask the user for the Plexus URL and do not proceed until provided.
2. Require an admin key. All admin requests need `x-admin-key`; prefer `PLEXUS_STAGING_ADMIN_KEY`. If absent, ask the user for it and do not proceed with admin calls until provided.
3. Verify access before making changes:

```bash
curl -fsS "$PLEXUS_STAGING_URL/v0/management/auth/verify" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq .
```

4. For read operations, use `GET` first and summarize findings. For write/delete/restore operations, inspect current state first and explain the intended change before issuing the mutating request.

Use this short helper pattern in the shell when running several commands interactively:

```bash
: "${PLEXUS_STAGING_URL:?Set PLEXUS_STAGING_URL}"
: "${PLEXUS_STAGING_ADMIN_KEY:?Set PLEXUS_STAGING_ADMIN_KEY}"

curl -fsS "$PLEXUS_STAGING_URL/v0/management/providers" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq .
```

## Safety Rules

- Never print, paste, or summarize full secrets unless the user explicitly asks. `GET /v0/management/keys` returns decrypted inference key secrets; redact them by default with `jq`.
- Treat `DELETE`, restore, log reset, and backup export files as sensitive operations. Confirm intent if the user did not clearly request the destructive action.
- Prefer `PATCH` for partial changes and `PUT` only for complete replacement or creation.
- For slugs or names containing `/`, quote the URL and encode path segments when needed. The backend supports wildcard routes for provider and alias IDs that contain slashes.
- If an endpoint returns validation details, report the exact field errors and stop instead of retrying with guessed payloads.

## Common Command Patterns

### Usage Summary For Totals

Prefer the summary endpoint whenever the user wants totals, rollups, dashboards, or time-window aggregates. It performs aggregation server-side and avoids undercounting that can happen if you inspect only the first page of raw usage rows.

```bash
curl -fsS "$PLEXUS_BASE_URL/v0/management/usage/summary?range=week" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY" | jq .
```

Use `range=hour|day|week|month`, or `range=custom&startDate=...&endDate=...` when the user needs a specific window.

### Pretty Read

Use raw usage reads for request-level inspection, spot checks, and debugging individual calls.

```bash
curl -fsS "$PLEXUS_BASE_URL/v0/management/usage?limit=20&sortDir=desc" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY" | jq .
```

### Redacted Key Listing

```bash
curl -fsS "$PLEXUS_BASE_URL/v0/management/keys" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY" \
  | jq 'with_entries(.value.secret = "<redacted>")'
```

### JSON Write

```bash
curl -fsS -X PATCH "$PLEXUS_BASE_URL/v0/management/config/failover" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY" \
  -H "content-type: application/json" \
  --data '{"enabled":true}' | jq .
```

### Save Payload From Existing State

Use this when making a precise edit to a larger object. Review the generated payload before sending it.

```bash
curl -fsS "$PLEXUS_BASE_URL/v0/management/aliases" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY" \
  | jq '."my-alias" | .target_groups[0].targets += [{"provider":"openai","model":"gpt-4o-mini"}]'
```

## Task Workflows

### Review Request Logs

- If the user wants totals, trends, token rollups, latency aggregates, dashboard numbers, or anything phrased as "how much" over a time window, start with `GET /v0/management/usage/summary` instead of paging through raw usage rows.
- Use `range=hour|day|week|month`, or `range=custom&startDate=...&endDate=...` for exact windows.
- Start with `GET /v0/management/usage` only when the task is request-level inspection, forensics, or debugging specific calls. Use `limit`, `sortDir=desc`, and targeted filters such as `requestId`, `apiKey`, `provider`, `incomingModelAlias`, `responseStatus`, or duration bounds.
- Use `fields` to reduce noise, for example `fields=requestId,date,apiKey,provider,incomingModelAlias,responseStatus,durationMs,costTotal`.
- For error investigation, also check `GET /v0/management/errors?limit=...` and debug logs if enabled.

### Review Or Toggle Debug Tracing

- Check state with `GET /v0/management/debug`.
- Enable globally with `PATCH /v0/management/debug` and `{"enabled":true,"providers":null}` or set `providers` to an array of provider slugs.
- Disable with `PATCH /v0/management/debug` and `{"enabled":false}`.
- List captures with `GET /v0/management/debug/logs?limit=50`.
- Fetch a full trace with `GET /v0/management/debug/logs/{requestId}`.

### Manage Providers And Model Targets

- List providers: `GET /v0/management/providers`.
- Create or replace provider: `PUT /v0/management/providers/{slug}` with a full `ProviderConfig`.
- Partially update provider: `PATCH /v0/management/providers/{slug}`.
- Delete provider: `DELETE /v0/management/providers/{slug}`. Use `?cascade=true` only when the user wants alias targets referencing that provider removed too.
- Fetch upstream models for setup: `POST /v0/management/providers/fetch-models` with `{"url":"https://.../v1/models","apiKey":"..."}`.
- Check provider quota checker status and balances with `GET /v0/management/quota-checkers`, `GET /v0/management/quotas`, and `GET /v0/management/quotas/{checkerId}`.

### Manage Model Aliases And Targets

- List aliases: `GET /v0/management/aliases`.
- Create or replace alias: `PUT /v0/management/aliases/{slug}` with a full alias config containing `target_groups`.
- Partially update alias: `PATCH /v0/management/aliases/{slug}`.
- Delete one alias: `DELETE /v0/management/models/{aliasId}`. This is verified in backend code and may differ from generated OpenAPI docs.
- Delete all aliases: `DELETE /v0/management/models`. Treat this as destructive.
- Alias target groups are ordered. The dispatcher exhausts healthy targets in earlier groups before later groups, so preserve group order when editing.

### Manage Inference Keys

- List keys: `GET /v0/management/keys`, redacted by default.
- Create or replace key: `PUT /v0/management/keys/{name}` with `secret` and optional `comment`, `allowedProviders`, `excludedProviders`, `allowedModels`, `excludedModels`, `allowedIps`, and `quota`.
- Omit `quota` for unrestricted keys; do not send `quota: null` because the current write schema accepts only strings when the field is present.
- Network restrictions are managed per inference key with `allowedIps` CIDR/IP entries, not through a separate network endpoint.
- Delete key: `DELETE /v0/management/keys/{name}`. Usage history remains attached to the key name, but future requests with that key fail.

### Manage User Quotas Applied To Inference Keys

- List definitions: `GET /v0/management/user-quotas`.
- Get one: `GET /v0/management/user-quotas/{name}`.
- Create or replace: `PUT /v0/management/user-quotas/{name}`.
- Patch: `PATCH /v0/management/user-quotas/{name}`.
- Delete: `DELETE /v0/management/user-quotas/{name}`. A 409 means a key still references the quota; remove the key assignment first.
- Assign a quota to a key by updating the key config with `quota: "quota_name"`.
- If `GET /v0/management/quota/status/{key}` returns 404 but `GET /v0/management/keys` shows the key exists, report an API/runtime consistency issue instead of assuming the key is missing.

### Manage MCP Gateway

- List servers: `GET /v0/management/mcp-servers`.
- Create or replace server: `PUT /v0/management/mcp-servers/{serverName}` with `upstream_url`, `enabled`, and optional `headers`.
- Delete server: `DELETE /v0/management/mcp-servers/{serverName}`.
- Review MCP proxy traffic: `GET /v0/management/mcp-logs?limit=20`, optionally `serverName=...` or `apiKey=...`.
- Delete MCP logs only when explicitly requested: `DELETE /v0/management/mcp-logs?olderThanDays=N` or `DELETE /v0/management/mcp-logs/{requestId}`.

### Manage General Settings

- Read all settings: `GET /v0/management/system-settings`.
- Bulk upsert settings: `PATCH /v0/management/system-settings`.
- Prefer dedicated endpoints when available: `/config/failover`, `/config/exploration-rate`, `/config/background-exploration`, `/config/cooldown`, `/config/timeout`, `/config/stall`, `/config/vision-fallthrough`, `/config/status`.
- Runtime logging level is managed at `/v0/management/logging/level`; `PUT` changes it until restart and `DELETE` resets it to startup default.

### Backup, Restore, And System Logs

- Config backup: `GET /v0/management/backup > plexus-config-backup.json`.
- Full backup: `GET /v0/management/backup?full=true > plexus-full-backup.tar.gz`.
- Restore config JSON: `POST /v0/management/restore` with `content-type: application/json` and `--data-binary @file.json`.
- Restore full backup: `POST /v0/management/restore` with `content-type: application/gzip` and `--data-binary @file.tar.gz`.
- Stream system logs with `GET /v0/system/logs/stream`; for more verbose logs, temporarily set runtime log level first.


## Reference Files

When exact endpoints or payload shapes matter, consult the endpoint map first.

To load the endpoint map, check for the local copy first. If found, read it directly; if absent, download it:

local: .agents/skills/plexus-management/references/endpoint-map.md
fallback with curl: "https://raw.githubusercontent.com/mcowger/plexus/refs/heads/main/.agents/skills/plexus-management/references/endpoint-map.md"

