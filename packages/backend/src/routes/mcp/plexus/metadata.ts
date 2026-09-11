import type { PlexusToolName } from './types';

export const PLEXUS_MANAGEMENT_PROMPT = `Plexus is a unified API gateway for LLMs. It exposes OpenAI- and Anthropic-compatible endpoints, provider-native raw endpoints, routes requests to configured providers, records usage, and manages provider, model alias, key, quota, debug, and MCP gateway configuration.

Use /mcp/plexus for admin-only Plexus management. All requests require x-admin-key. Do not use bearer inference keys for this endpoint.

The tools are compact domain tools. Prefer inspection before mutation: list or get the current state, explain the intended change, then call the relevant tool with operation, id, category, query, and body.

Destructive or high-impact operations require destructive: "acknowledged". Secrets are redacted by default. Only request redact: false when you have specific authorization and the operation explicitly supports unredacted output.

Common workflows:
- Review request activity with plexus_usage list or summary.
- Inspect or update provider setup with plexus_provider list, get, put, update, delete, or fetch_models.
- Raw provider access uses provider raw_passthrough { enabled, base_url, auth } plus key allowRawPassthrough. It is provider-wide, bypasses model restrictions/routing/failover/transformation, and should be treated as high-impact.
- Inspect or update model routing with plexus_model_alias list, get, put, update, delete, or delete_all.
- Inspect or update inference keys with plexus_key list, get, put, update, or delete; normal responses redact secrets.
- Check upstream quota state with plexus_quota_checker types, list, or get.
- Inspect or update user quota definitions with plexus_quota list, get, put, update, or delete; check or repair a key's quota usage with plexus_quota status, clear, or recompute.
- Review or update MCP gateway configuration with plexus_mcp_gateway servers_list, get, put, update, or delete.
- Inspect general settings with plexus_settings get and a category.
- Inspect recent system logs with plexus_system_logs recent.
- Inspect or change the runtime logging level with plexus_system_logs level, set_level, or reset_level.
- Use plexus_debug state before enabling debug tracing.
- Use plexus_operations backup, restore, refresh_metadata, list_cooldowns, or clear_cooldowns for operational actions.

Best practices:
- Keep changes narrow and reversible.
- Avoid broad overwrite operations unless necessary.
- Never expose provider API keys, inference key secrets, cookies, sessions, or OAuth tokens in chat unless specifically authorized.
- Include enough context in body payloads for future auditability.`;

export const TOOL_NAMES = [
  'plexus_config',
  'plexus_provider',
  'plexus_model_alias',
  'plexus_key',
  'plexus_quota',
  'plexus_quota_checker',
  'plexus_usage',
  'plexus_debug',
  'plexus_mcp_gateway',
  'plexus_settings',
  'plexus_system_logs',
  'plexus_operations',
] as const satisfies readonly PlexusToolName[];

export function getToolDescription(toolName: string) {
  switch (toolName) {
    case 'plexus_config':
      return 'Inspect Plexus configuration and status. Initial operations: get, export, status.';
    case 'plexus_provider':
      return 'Inspect and manage providers and provider routing configuration. Operations: list, get, put, create, update, delete, fetch_models. Static API-key providers may define raw_passthrough { enabled, base_url, auth } to expose /raw/{provider}/* without routing, failover, adapters, or payload transformation.';
    case 'plexus_model_alias':
      return 'Inspect and manage model aliases, targets, and target groups. Operations: list, get, put, create, update, delete, delete_all.';
    case 'plexus_key':
      return 'Inspect and manage inference keys with secrets redacted. Operations: list, get, put, create, update, delete. Keys carry quotas: string[] to assign one or more quota definitions (legacy singular quota field is still accepted on input and folded into quotas). allowRawPassthrough grants provider-wide raw access to raw-enabled providers permitted by the key provider policy; model restrictions do not apply.';
    case 'plexus_quota':
      return "Inspect and manage user quota definitions, and check or repair per-key quota usage. Operations: list, get, put, create, update, delete, status, clear, recompute. Quota definitions carry scope fields (allowedProviders, excludedProviders, allowedModels, excludedModels; omitted when unscoped), shared (pooled across keys), and an optional warnAt threshold. status (id: key) returns { key, quotas: [...] } — one entry per quota attached to the key (assigned or default-sourced), each with name, limitType, limit, currentUsage, remaining, allowed, resetsAt, scope, global, shared, source ('assigned' | 'default'), and warnAt (only when set on the definition), plus legacy top-level quota_name/allowed/current_usage/limit/remaining/resets_at fields derived from the most-constrained entry. clear (body: { key, quota? }, destructive: \"acknowledged\") resets usage for one named quota, or every quota attached to the key when quota is omitted. recompute (body: { key, quota }, both required) repairs a quota's cached usage by recalculating from stored request records; it 400s with a reason (e.g. unsupported_quota_type) for leaky rolling tokens/requests quotas that cannot be recomputed, and its windowStartMs is a raw epoch-ms number. clear and recompute 404 when the key does not exist and 400 when the quota is not attached to that key.";
    case 'plexus_quota_checker':
      return 'Inspect upstream provider quota checker configuration. Initial operations: types, list, get.';
    case 'plexus_usage':
      return 'Review request logs and summaries. Operations: list, summary, delete, delete_all. Raw provider calls are distinct from passthrough and report isRaw: true with requestMethod and requestPath.';
    case 'plexus_debug':
      return 'Review and manage debug tracing. Operations: state, update, logs, get_log, delete_log, delete_all_logs. Debug capture targets are in-memory and inclusive: update body may include enabled, keys, aliases, and providers; a request is captured when any enabled dimension matches.';
    case 'plexus_mcp_gateway':
      return 'Inspect and manage Plexus upstream MCP gateway configuration. Operations: servers_list, list, get, put, create, update, delete, status, start, stop, restart, logs.';
    case 'plexus_settings':
      return 'Inspect Plexus settings by category. Initial operations: get.';
    case 'plexus_system_logs':
      return 'Inspect recent Plexus system logs and control runtime log verbosity. Operations: recent, level, set_level, reset_level.';
    case 'plexus_operations':
      return 'Run high-impact operational actions. Operations: backup, restore, restart, refresh_metadata, list_cooldowns, clear_cooldowns, reset_logs.';
    default:
      return 'Plexus management tool.';
  }
}
