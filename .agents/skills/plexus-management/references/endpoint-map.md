# Plexus Management Endpoint Map

This map summarizes the management endpoints commonly needed by agents. Prefer these paths, then consult `docs/openapi/paths/` for full parameter details and `docs/openapi/components/schemas/` for request bodies.

All admin calls require:

```bash
-H "x-admin-key: $PLEXUS_ADMIN_KEY"
```

Use `PLEXUS_BASE_URL` as the instance root, for example `https://plexus.example.com`.

## Authentication

| Action | Method | Path |
| --- | --- | --- |
| Verify principal | `GET` | `/v0/management/auth/verify` |
| Current limited/admin info | `GET` | `/v0/management/self/me` |
| Rotate current key | `POST` | `/v0/management/self/rotate` |

## Request Usage And Errors

| Action | Method | Path |
| --- | --- | --- |
| List usage records | `GET` | `/v0/management/usage` |
| Usage summary | `GET` | `/v0/management/usage/summary` |
| Delete one usage record | `DELETE` | `/v0/management/usage/{requestId}` |
| Delete usage records | `DELETE` | `/v0/management/usage?olderThanDays=N` |
| List inference errors | `GET` | `/v0/management/errors` |
| Delete one error | `DELETE` | `/v0/management/errors/{requestId}` |
| Delete all errors | `DELETE` | `/v0/management/errors` |

Useful usage query params include `limit`, `offset`, `sortBy`, `sortDir`, `startDate`, `endDate`, `apiKey`, `attribution`, `incomingApiType`, `provider`, `incomingModelAlias`, `selectedModelName`, `outgoingApiType`, `responseStatus`, `minDurationMs`, `maxDurationMs`, and `fields`.

Raw provider records have `isRaw: true`, `incomingApiType: "raw"`, and include
`requestMethod` plus the upstream `requestPath`. `isPassthrough` describes a
different transformed-inference optimization and remains false for raw calls.
For recognized Chat Completions, Messages, Responses, and Gemini paths, usage
records also include any model, token, cache/reasoning, and provider cost data
that Plexus can observe without changing the raw traffic.

## Debug Tracing

| Action | Method | Path |
| --- | --- | --- |
| Get debug state | `GET` | `/v0/management/debug` |
| Update in-memory debug state | `PATCH` | `/v0/management/debug` |
| Toggle current key debug | `POST` | `/v0/management/self/debug/toggle` |
| List debug logs | `GET` | `/v0/management/debug/logs` |
| Get one debug log | `GET` | `/v0/management/debug/logs/{requestId}` |
| Delete one debug log | `DELETE` | `/v0/management/debug/logs/{requestId}` |
| Delete all debug logs | `DELETE` | `/v0/management/debug/logs` |

Debug state body examples:

```json
{"enabled":true}
{"enabled":false,"keys":["mobile-app"],"aliases":["gpt-4o-mini"],"providers":["openai","anthropic"]}
{"keys":null,"aliases":null,"providers":null}
{"enabled":false}
```

Debug target state is in-memory only. Capture is inclusive: a request is
recorded when any enabled dimension matches the request key, canonical model
alias, selected provider, or global flag. `providers` is a provider target list,
not a filter that suppresses global/key/alias capture.

## Providers And Provider Quotas

| Action | Method | Path |
| --- | --- | --- |
| List providers | `GET` | `/v0/management/providers` |
| Get one provider | `GET` | `/v0/management/providers/{slug}` |
| Create or replace provider | `PUT` | `/v0/management/providers/{slug}` |
| Patch provider | `PATCH` | `/v0/management/providers/{slug}` |
| Delete provider | `DELETE` | `/v0/management/providers/{slug}` |
| Delete provider and alias targets | `DELETE` | `/v0/management/providers/{slug}?cascade=true` |
| Fetch upstream model list | `POST` | `/v0/management/providers/fetch-models` |
| List quota checker types/status | `GET` | `/v0/management/quota-checkers` |
| List quota snapshots | `GET` | `/v0/management/quotas` |
| Get one quota snapshot | `GET` | `/v0/management/quotas/{checkerId}` |
| Trigger one quota check | `POST` | `/v0/management/quotas/{checkerId}/check` |
| Quota history | `GET` | `/v0/management/quotas/{checkerId}/history` |

Minimal provider body:

```json
{"api_base_url":"https://api.openai.com/v1","api_key":"$env:OPENAI_API_KEY","enabled":true}
```

Provider quota checkers are configured in the provider's `quota_checker` field. Discover supported checker types with `/v0/management/quota-checker-types` or `/v0/management/quota-checkers` before writing config.

Raw provider configuration:

```json
{"raw_passthrough":{"enabled":true,"base_url":"https://openrouter.ai/api","auth":"bearer"}}
```

This exposes `/raw/{provider}/*` for static API-key providers. It bypasses model
routing, failover, adapters, and payload transformation. Inspect key access before
enabling it; callers need `allowRawPassthrough: true` and provider policy access.

## Model Aliases

| Action | Method | Path |
| --- | --- | --- |
| List aliases | `GET` | `/v0/management/aliases` |
| Create or replace alias | `PUT` | `/v0/management/aliases/{slug}` |
| Patch alias | `PATCH` | `/v0/management/aliases/{slug}` |
| Delete one alias | `DELETE` | `/v0/management/models/{aliasId}` |
| Delete all aliases | `DELETE` | `/v0/management/models` |

Alias deletion is implemented under `/v0/management/models/*` in `packages/backend/src/routes/management/config.ts`, while create/update/list use `/v0/management/aliases`. Generated OpenAPI docs may not show this delete route.

Minimal alias body:

```json
{
  "type": "chat",
  "target_groups": [
    {
      "name": "default",
      "selector": "random",
      "targets": [{"provider":"openai","model":"gpt-4o-mini"}]
    }
  ]
}
```

Selectors include `random`, `in_order`, `cost`, `latency`, `usage`, `performance`, and `e2e_performance`.

## Inference Keys

| Action | Method | Path |
| --- | --- | --- |
| List keys | `GET` | `/v0/management/keys` |
| Create or replace key | `PUT` | `/v0/management/keys/{name}` |
| Delete key | `DELETE` | `/v0/management/keys/{name}` |

Key bodies require `secret`. Optional fields include `comment`, `allowedProviders`, `excludedProviders`, `allowedModels`, `excludedModels`, `allowedIps`, `allowRawPassthrough`, and `quota`.

`allowRawPassthrough: true` grants provider-wide access to each raw-enabled
provider permitted by the key's provider allow/deny lists. Model restrictions do
not apply to raw traffic.

For no quota, omit the `quota` field. Do not send `quota: null` to create/update key endpoints; the current write schema accepts only strings when `quota` is present.

Network restrictions are configured per inference key using `allowedIps` CIDR/IP entries. The backend supports this field even if generated schema docs lag behind the implementation.

## User Quotas

| Action | Method | Path |
| --- | --- | --- |
| List quota definitions | `GET` | `/v0/management/user-quotas` |
| Get one quota definition | `GET` | `/v0/management/user-quotas/{name}` |
| Create or replace quota | `PUT` | `/v0/management/user-quotas/{name}` |
| Patch quota | `PATCH` | `/v0/management/user-quotas/{name}` |
| Delete quota | `DELETE` | `/v0/management/user-quotas/{name}` |
| Key quota status | `GET` | `/v0/management/quota/status/{key}` |
| Clear quota state | `POST` | `/v0/management/quota/clear` |

Quota definition examples:

```json
{"type":"rolling","duration":"1h","limitType":"tokens","limit":100000}
{"type":"daily","limitType":"requests","limit":1000}
{"type":"monthly","limitType":"cost","limit":50}
```

Names must match `^[a-z0-9][a-z0-9-_]{1,62}$`.

If quota status returns 404 for a key that is visible in `/v0/management/keys`, treat it as an API/runtime consistency issue and report both facts. Do not silently claim the key is absent.

## MCP Gateway

| Action | Method | Path |
| --- | --- | --- |
| List MCP servers | `GET` | `/v0/management/mcp-servers` |
| Create or replace server | `PUT` | `/v0/management/mcp-servers/{serverName}` |
| Delete server | `DELETE` | `/v0/management/mcp-servers/{serverName}` |
| List MCP logs | `GET` | `/v0/management/mcp-logs` |
| Delete one MCP log | `DELETE` | `/v0/management/mcp-logs/{requestId}` |
| Delete MCP logs | `DELETE` | `/v0/management/mcp-logs?olderThanDays=N` |

Minimal MCP server body:

```json
{"upstream_url":"https://mcp.example.com","enabled":true,"headers":{}}
```

## General Configuration

| Action | Method | Path |
| --- | --- | --- |
| Read all system settings | `GET` | `/v0/management/system-settings` |
| Bulk upsert system settings | `PATCH` | `/v0/management/system-settings` |
| Config status | `GET` | `/v0/management/config/status` |
| Read/export runtime config | `GET` | `/v0/management/config` |
| Export config | `GET` | `/v0/management/config/export` |
| Failover config | `GET`, `PATCH` | `/v0/management/config/failover` |
| Exploration rates | `GET`, `PATCH` | `/v0/management/config/exploration-rate` |
| Background exploration | `GET`, `PATCH` | `/v0/management/config/background-exploration` |
| Cooldown config | `GET`, `PATCH` | `/v0/management/config/cooldown` |
| Timeout config | `GET`, `PATCH` | `/v0/management/config/timeout` |
| Stall detection config | `GET`, `PATCH` | `/v0/management/config/stall` |
| Vision fallthrough config | `GET`, `PATCH` | `/v0/management/config/vision-fallthrough` |
| Cooldown state | `GET` | `/v0/management/cooldowns` |
| Clear provider cooldown | `DELETE` | `/v0/management/cooldowns/{provider}` |
| Concurrency status | `GET` | `/v0/management/concurrency` |
| Performance rows | `GET` | `/v0/management/performance` |
| Metrics | `GET` | `/v0/management/metrics` |

Common patch bodies:

```json
{"enabled":true,"retryableStatusCodes":[429,500,502,503,504],"retryableErrors":["rate.limit","timeout"]}
{"performanceExplorationRate":0.02,"latencyExplorationRate":0.02,"e2ePerformanceExplorationRate":0.02}
{"defaultSeconds":300}
{"ttfbSeconds":15,"ttfbBytes":100,"minBytesPerSecond":500,"windowSeconds":10,"gracePeriodSeconds":30}
```

## Logging And System Logs

| Action | Method | Path |
| --- | --- | --- |
| Get runtime log level | `GET` | `/v0/management/logging/level` |
| Set runtime log level | `PUT` | `/v0/management/logging/level` |
| Reset runtime log level | `DELETE` | `/v0/management/logging/level` |
| Module log filters | `GET`, `PUT` | `/v0/management/logging/modules` |
| Clear module log filters | `DELETE` | `/v0/management/logging/modules` |
| Reset request/error/debug logs | `DELETE` | `/v0/management/logs/reset` |
| Stream system logs | `GET` | `/v0/system/logs/stream` |

Set log level body:

```json
{"level":"debug"}
```

System logs are Server-Sent Events. Example:

```bash
curl -N "$PLEXUS_BASE_URL/v0/system/logs/stream" \
  -H "x-admin-key: $PLEXUS_ADMIN_KEY"
```

## Backup And Restore

| Action | Method | Path |
| --- | --- | --- |
| Config-only backup | `GET` | `/v0/management/backup` |
| Full backup archive | `GET` | `/v0/management/backup?full=true` |
| Restore backup | `POST` | `/v0/management/restore` |
| Restart server | `POST` | `/v0/management/restart` |

Config-only backup returns JSON. Full backup returns a gzipped tar archive. Backups include decrypted sensitive fields so they must be stored and shared carefully.

Restore replaces current data. After restore, restart is recommended so in-memory caches and long-lived connections pick up the new configuration.
