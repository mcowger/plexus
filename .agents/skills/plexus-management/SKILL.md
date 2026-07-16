---
name: plexus-management
description: >-
  Use this skill to inspect or administer a running Plexus instance via the management API, or debug
  failures touching Plexus-proxied traffic (oauth, routing, model targets, raw provider passthrough, inference keys, MCP gateway)
  rather than searching the local codebase. Covers request logs, debug traces (lookup by UUID), enabling/disabling
  debug capture, providers, model targets, balances, quotas, aliases, target groups, keys, MCP logs, and
  runtime settings (failover, cooldowns, timeouts, backup/restore). Prefer this for any Plexus admin, operational,
  or live-debugging task, even if the user only says "check Plexus", "look at logs", "update a provider",
  "rotate keys", "configure quotas", "debug a request", "review debug trace", or "upstream error" — Plexus state
  lives behind the management API, not in local files.
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
curl -fsS "$PLEXUS_STAGING_URL/v0/management/usage/summary?range=week" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq .
```

Use `range=hour|day|week|month`, or `range=custom&startDate=...&endDate=...` when the user needs a specific window.

### Pretty Read

Use raw usage reads for request-level inspection, spot checks, and debugging individual calls.

```bash
curl -fsS "$PLEXUS_STAGING_URL/v0/management/usage?limit=20&sortDir=desc" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq .
```

### Redacted Key Listing

```bash
curl -fsS "$PLEXUS_STAGING_URL/v0/management/keys" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" \
  | jq 'with_entries(.value.secret = "<redacted>")'
```

### JSON Write

```bash
curl -fsS -X PATCH "$PLEXUS_STAGING_URL/v0/management/config/failover" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" \
  -H "content-type: application/json" \
  --data '{"enabled":true}' | jq .
```

### Save Payload From Existing State

Use this when making a precise edit to a larger object. Review the generated payload before sending it.

```bash
curl -fsS "$PLEXUS_STAGING_URL/v0/management/aliases" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" \
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
- Debug target state is in-memory only; it resets on process restart except for `DEBUG=true` startup global capture.
- Enable globally with `PATCH /v0/management/debug` and `{"enabled":true}`.
- Set inclusive capture targets with `PATCH /v0/management/debug` and any of `keys`, `aliases`, or `providers`, for example `{"enabled":false,"keys":["mobile-app"],"aliases":["gpt-4o-mini"],"providers":["openai"]}`.
- Capture is inclusive: a request is recorded when any enabled dimension matches the request key, canonical model alias, selected provider, or global flag. Setting `providers` does not filter out global/key/alias capture.
- Clear a target list by sending `null` or `[]`, for example `{"providers":null}`.
- Disable with `PATCH /v0/management/debug` and `{"enabled":false}`.
- List captures with `GET /v0/management/debug/logs?limit=50`.
- Fetch a full trace with `GET /v0/management/debug/logs/{requestId}`.

The list response is a newest-first JSON array containing only `requestId`, `createdAt`, and `responseStatus`. Use its request ID to fetch the detail:

```bash
REQUEST_ID=$(
  curl -fsS "$PLEXUS_STAGING_URL/v0/management/debug/logs?limit=1" \
    -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq -r '.[0].requestId'
)

curl -fsS "$PLEXUS_STAGING_URL/v0/management/debug/logs/$REQUEST_ID" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" | jq .
```

#### Annotated Debug Trace Example

The detail endpoint returns payloads and headers as JSON-encoded strings, not nested JSON values. This illustrative Chat Completions trace has the exact outer response shape:

```json
{
  "requestId": "018f2f89-6f43-7f4d-a714-93d35e35b8a1",
  "createdAt": 1784217600123,
  "rawRequest": "{\"model\":\"support\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"stream\":true}",
  "transformedRequest": "{\"model\":\"gpt-4.1-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"stream\":true}",
  "rawResponse": "data: {\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"}}]}\n\ndata: {\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":1,\"total_tokens\":9}}\n\ndata: [DONE]\n\n",
  "transformedResponse": "data: {\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"}}]}\n\ndata: {\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":1,\"total_tokens\":9}}\n\ndata: [DONE]\n\n",
  "rawResponseSnapshot": "{\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":1,\"total_tokens\":9}}",
  "transformedResponseSnapshot": "{\"id\":\"chatcmpl_upstream\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":1,\"total_tokens\":9}}",
  "requestHeaders": "{\"authorization\":\"Bearer sk-v...-key\",\"content-type\":\"application/json\"}",
  "responseHeaders": "{\"content-type\":\"text/event-stream\",\"x-request-id\":\"upstream-request-id\"}",
  "responseStatus": 200
}
```

- `createdAt` is Unix epoch milliseconds; render it with `jq -r '.createdAt / 1000 | todateiso8601'`.
- `rawRequest` is the client-facing request body. `transformedRequest` is the provider-facing body after alias resolution and adapters, so compare these first when debugging request transformation.
- `rawResponse` is the exact captured upstream body. `transformedResponse` is the exact body returned after Plexus transformation. Streaming bodies remain SSE text and may end with `[DONE]`.
- `rawResponseSnapshot` and `transformedResponseSnapshot` are best-effort reconstructed final objects used for inspection and usage extraction. Prefer the corresponding exact response field when ordering, malformed chunks, comments, or wire formatting matter.
- Any unavailable stage is `null`. Response capture is capped at 10 MiB and appends `[DEBUG OUTPUT TRUNCATED - Exceeded 10MB limit]` when exceeded.
- The detail response does not expose the captured key, provider, or model alias. Correlate by `requestId` with `GET /v0/management/usage?requestId=...` when those routing fields matter.
- Sensitive request headers are masked before capture, but request/response bodies and nonstandard headers can still contain customer data or secrets. Do not paste a full trace into chat; extract and redact only the fields needed.

Decode JSON-valued strings while leaving SSE/plain-text bodies unchanged:

```bash
curl -fsS "$PLEXUS_STAGING_URL/v0/management/debug/logs/$REQUEST_ID" \
  -H "x-admin-key: $PLEXUS_STAGING_ADMIN_KEY" \
  | jq 'reduce ["rawRequest", "transformedRequest", "rawResponse", "transformedResponse", "rawResponseSnapshot", "transformedResponseSnapshot", "requestHeaders", "responseHeaders"][] as $field (.; .[$field] |= (. as $value | try fromjson catch $value))'
```

### Manage Providers And Model Targets

- List providers: `GET /v0/management/providers`.
- Create or replace provider: `PUT /v0/management/providers/{slug}` with a full `ProviderConfig`.
- Partially update provider: `PATCH /v0/management/providers/{slug}`.
- Delete provider: `DELETE /v0/management/providers/{slug}`. Use `?cascade=true` only when the user wants alias targets referencing that provider removed too.
- Fetch upstream models for setup: `POST /v0/management/providers/fetch-models` with `{"url":"https://.../v1/models","apiKey":"..."}`.
- Check provider quota checker status and balances with `GET /v0/management/quota-checkers`, `GET /v0/management/quotas`, and `GET /v0/management/quotas/{checkerId}`.
- Raw provider access is configured with `raw_passthrough: { enabled, base_url, auth }`, where `auth` is `bearer`, `x-api-key`, or `x-goog-api-key`. It is supported for static API-key providers and exposes `/raw/{provider}/*` without model routing, failover, adapters, or payload transformation.
- Treat raw enablement as high-impact: inspect the provider and relevant key policies first. A caller also needs `allowRawPassthrough: true`, and its provider allow/deny lists still apply.

### Manage Model Aliases And Targets

- List aliases: `GET /v0/management/aliases`.
- Create or replace alias: `PUT /v0/management/aliases/{slug}` with a full alias config containing `target_groups`.
- Partially update alias: `PATCH /v0/management/aliases/{slug}`.
- Delete one alias: `DELETE /v0/management/models/{aliasId}`. This is verified in backend code and may differ from generated OpenAPI docs.
- Delete all aliases: `DELETE /v0/management/models`. Treat this as destructive.
- Alias target groups are ordered. The dispatcher exhausts healthy targets in earlier groups before later groups, so preserve group order when editing.

### Manage Inference Keys

- List keys: `GET /v0/management/keys`, redacted by default.
- Create or replace key: `PUT /v0/management/keys/{name}` with `secret` and optional `comment`, `allowedProviders`, `excludedProviders`, `allowedModels`, `excludedModels`, `allowedIps`, `allowRawPassthrough`, and `quota`.
- Omit `quota` for unrestricted keys; do not send `quota: null` because the current write schema accepts only strings when the field is present.
- Network restrictions are managed per inference key with `allowedIps` CIDR/IP entries, not through a separate network endpoint.
- `allowRawPassthrough: true` is provider-wide for every raw-enabled provider permitted by the key's provider policy. Model allow/deny lists do not constrain raw requests.
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
