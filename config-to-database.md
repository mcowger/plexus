# Config-to-Database Migration Plan

## Goal

Move all runtime configuration data from `plexus.yaml` and `auth.json` into database tables, eliminating the need for these files entirely. `adminKey`, `DATABASE_URL`, and `PORT` become environment variables only. On first launch with an empty database, automatically import from existing YAML/JSON files if present.

---

## What Is Removed (No More Config Files)

`plexus.yaml` and `auth.json` are fully eliminated. All configuration is database-driven. Bootstrap settings are provided via environment variables:

| Env Var | Description | Default |
|---|---|---|
| `ADMIN_KEY` | Admin key for management API | *(required)* |
| `DATABASE_URL` | DB connection string | `sqlite://config/usage.sqlite` |
| `PORT` | Server port | `4000` |

Everything else moves to the database.

---

## What Moves to Database

| Current Location | Data | New DB Table |
|---|---|---|
| `plexus.yaml → providers` | Provider configs (api_base_url, api_key, headers, models, quota_checker, etc.) | `providers` + `provider_models` |
| `plexus.yaml → models` | Model aliases (targets, selector, priority, advanced, metadata) | `model_aliases` + `model_alias_targets` |
| `plexus.yaml → keys` | API keys (secret, comment, quota) | `api_keys` |
| `plexus.yaml → user_quotas` | User quota definitions (type, limitType, limit, duration) | `user_quota_definitions` |
| `plexus.yaml → failover` | Failover policy (enabled, retryableStatusCodes, retryableErrors) | `system_settings` (key-value) |
| `plexus.yaml → cooldown` | Cooldown policy (initialMinutes, maxMinutes) | `system_settings` (key-value) |
| `plexus.yaml → mcp_servers` | MCP server configs (upstream_url, enabled, headers) | `mcp_servers` |
| `plexus.yaml → performanceExplorationRate` | Exploration rates | `system_settings` (key-value) |
| `plexus.yaml → latencyExplorationRate` | Exploration rates | `system_settings` (key-value) |
| `auth.json` | OAuth credentials (access, refresh, expires per provider/account) | `oauth_credentials` |

---

## Phase 1: Database Schema (New Tables)

All schemas must be created for **both SQLite and PostgreSQL** dialects per project conventions. All tables use integer surrogate PKs (better for joins and consistency). Enum-valued text columns use PostgreSQL native `CREATE TYPE ... AS ENUM` and SQLite `CHECK` constraints. All JSON columns use `jsonb` (supported in SQLite ≥ 3.38 and natively in PostgreSQL). All timestamps use `bigint` (milliseconds since epoch) matching existing project conventions.

### 1.1 `providers` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | Surrogate key |
| `slug` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | Provider identifier (e.g. "openai") |
| `display_name` | text | text | Optional friendly name |
| `api_base_url` | jsonb | jsonb | String URL or `{"chat":"...","messages":"..."}` |
| `api_key` | text | text | Bearer token or "oauth" |
| `oauth_provider_type` | text CHECK(enum) | oauth_provider_type ENUM | Nullable: 'anthropic', 'openai-codex', 'github-copilot', 'google-gemini-cli', 'google-antigravity' |
| `oauth_credential_id` | integer FK → oauth_credentials.id | integer FK | Nullable, references the oauth_credentials row |
| `enabled` | integer | boolean | Default true |
| `disable_cooldown` | integer | boolean | Default false |
| `discount` | real | real | Nullable, 0-1 |
| `estimate_tokens` | integer | boolean | Default false |
| `headers` | jsonb | jsonb | Nullable, custom HTTP headers |
| `extra_body` | jsonb | jsonb | Nullable, extra body params |
| `quota_checker_type` | text CHECK(enum) | quota_checker_type ENUM | Nullable |
| `quota_checker_id` | text | text | Nullable, custom checker ID override |
| `quota_checker_enabled` | integer | boolean | Default true |
| `quota_checker_interval` | integer | integer | Default 30 (minutes) |
| `quota_checker_options` | jsonb | jsonb | Nullable |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

**Enum values for `oauth_provider_type`:** `anthropic`, `openai-codex`, `github-copilot`, `google-gemini-cli`, `google-antigravity`

**Enum values for `quota_checker_type`:** `naga`, `synthetic`, `nanogpt`, `zai`, `moonshot`, `minimax`, `minimax-coding`, `openrouter`, `kilo`, `openai-codex`, `claude-code`, `kimi-code`, `copilot`, `wisdomgate`, `apertis`, `poe`

### 1.2 `provider_models` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `provider_id` | integer FK → providers.id | integer FK | ON DELETE CASCADE |
| `model_name` | text | text | Model slug |
| `pricing_config` | jsonb | jsonb | Nullable, full pricing object |
| `model_type` | text CHECK(enum) | model_type ENUM | Nullable: 'chat', 'embeddings', 'transcriptions', 'speech', 'image', 'responses' |
| `access_via` | jsonb | jsonb | Nullable, array of API type strings |
| `sort_order` | integer | integer | Preserve ordering |

**Unique constraint:** `(provider_id, model_name)`

### 1.3 `model_aliases` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | Surrogate key |
| `slug` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | Alias name (e.g. "smart-model") |
| `selector` | text CHECK(enum) | selector_strategy ENUM | Nullable: 'random', 'in_order', 'cost', 'latency', 'usage', 'performance' |
| `priority` | text CHECK(enum) | alias_priority ENUM | Default 'selector': 'selector', 'api_match' |
| `model_type` | text CHECK(enum) | model_type ENUM | Nullable: 'chat', 'embeddings', 'transcriptions', 'speech', 'image', 'responses' |
| `additional_aliases` | jsonb | jsonb | Nullable, array of strings |
| `advanced` | jsonb | jsonb | Nullable, array of behavior objects |
| `metadata_source` | text CHECK(enum) | metadata_source ENUM | Nullable: 'openrouter', 'models.dev', 'catwalk' |
| `metadata_source_path` | text | text | Nullable |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

### 1.4 `model_alias_targets` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `alias_id` | integer FK → model_aliases.id | integer FK | ON DELETE CASCADE |
| `provider_slug` | text | text | Provider slug (soft reference, not FK, allows referencing disabled/missing providers) |
| `model_name` | text | text | Model slug on that provider |
| `enabled` | integer | boolean | Default true |
| `sort_order` | integer | integer | Preserve target ordering |

**Unique constraint:** `(alias_id, provider_slug, model_name)`

### 1.5 `api_keys` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `name` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | Key alias (e.g. "my-app-key") |
| `secret` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | The actual bearer token |
| `comment` | text | text | Nullable |
| `quota_name` | text | text | Nullable, soft FK → user_quota_definitions.name |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

### 1.6 `user_quota_definitions` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `name` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | Quota name (e.g. "premium-plan") |
| `quota_type` | text CHECK(enum) | quota_type ENUM | 'rolling', 'daily', 'weekly' |
| `limit_type` | text CHECK(enum) | limit_type ENUM | 'requests', 'tokens' |
| `limit_value` | integer | integer | |
| `duration` | text | text | Nullable, required for rolling (e.g. "1h") |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

### 1.7 `mcp_servers` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `name` | text UNIQUE NOT NULL | text UNIQUE NOT NULL | Server slug |
| `upstream_url` | text | text | |
| `enabled` | integer | boolean | Default true |
| `headers` | jsonb | jsonb | Nullable |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

### 1.8 `system_settings` table (key-value for policies and rates)

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `key` | text PK | text PK | e.g. 'failover.enabled', 'cooldown.initialMinutes' |
| `value` | jsonb | jsonb | Serialized value |
| `updated_at` | bigint | bigint | Epoch milliseconds |

Settings keys:
- `failover.enabled`, `failover.retryableStatusCodes`, `failover.retryableErrors`
- `cooldown.initialMinutes`, `cooldown.maxMinutes`
- `performanceExplorationRate`, `latencyExplorationRate`

### 1.9 `oauth_credentials` table

| Column | SQLite Type | PG Type | Notes |
|---|---|---|---|
| `id` | integer PK AUTOINCREMENT | serial PK | |
| `oauth_provider_type` | text CHECK(enum) | oauth_provider_type ENUM | e.g. 'anthropic', 'openai-codex' |
| `account_id` | text | text | e.g. 'work', 'personal' |
| `access_token` | text | text | |
| `refresh_token` | text | text | |
| `expires_at` | bigint | bigint | Epoch seconds |
| `created_at` | bigint | bigint | Epoch milliseconds |
| `updated_at` | bigint | bigint | Epoch milliseconds |

**Unique constraint:** `(oauth_provider_type, account_id)`

---

## Phase 2: Config Service Layer (New)

### 2.1 `ConfigRepository` — Database abstraction

New file: `packages/backend/src/db/config-repository.ts`

A single class that encapsulates all config CRUD against the database using **Drizzle ORM** exclusively (no raw SQL). Methods grouped by entity:

**Providers:**
- `getAllProviders(): Promise<ProviderConfig[]>`
- `getProvider(slug: string): Promise<ProviderConfig | null>`
- `saveProvider(slug: string, config: ProviderConfig): Promise<void>`
- `deleteProvider(slug: string, cascade: boolean): Promise<void>`
- `getProviderModels(providerSlug: string): Promise<ProviderModelConfig[]>`

**Model Aliases:**
- `getAllAliases(): Promise<Record<string, ModelConfig>>`
- `getAlias(slug: string): Promise<ModelConfig | null>`
- `saveAlias(slug: string, config: ModelConfig): Promise<void>`
- `deleteAlias(slug: string): Promise<void>`
- `deleteAllAliases(): Promise<number>`

**API Keys:**
- `getAllKeys(): Promise<Record<string, KeyConfig>>`
- `getKeyBySecret(secret: string): Promise<{name: string, config: KeyConfig} | null>`
- `saveKey(name: string, config: KeyConfig): Promise<void>`
- `deleteKey(name: string): Promise<void>`

**User Quotas:**
- `getAllUserQuotas(): Promise<Record<string, QuotaDefinition>>`
- `saveUserQuota(name: string, quota: QuotaDefinition): Promise<void>`
- `deleteUserQuota(name: string): Promise<void>`

**MCP Servers:**
- `getAllMcpServers(): Promise<Record<string, McpServerConfig>>`
- `saveMcpServer(name: string, config: McpServerConfig): Promise<void>`
- `deleteMcpServer(name: string): Promise<void>`

**Settings:**
- `getSetting<T>(key: string, defaultValue: T): Promise<T>`
- `setSetting(key: string, value: unknown): Promise<void>`
- `getFailoverPolicy(): Promise<FailoverPolicy>`
- `getCooldownPolicy(): Promise<CooldownPolicy>`

**OAuth Credentials:**
- `getOAuthCredentials(providerType: string, accountId?: string): Promise<OAuthCredentials | null>`
- `setOAuthCredentials(providerType: string, accountId: string, creds: OAuthCredentials): Promise<void>`
- `deleteOAuthCredentials(providerType: string, accountId: string): Promise<void>`
- `getAllOAuthProviders(): Promise<{providerType: string, accountId: string}[]>`

### 2.2 `ConfigService` — In-memory cache + DB sync

New file: `packages/backend/src/services/config-service.ts`

Replaces `getConfig()` as the single source of truth. Holds an in-memory `PlexusConfig` object that is:
1. Loaded from DB on startup
2. Updated in-memory whenever a write operation occurs
3. Never stale (writes go to DB first, then update cache)

```typescript
class ConfigService {
  private static instance: ConfigService;
  private cache: PlexusConfig;
  private repo: ConfigRepository;

  static getInstance(): ConfigService;

  // Load full config from DB into cache
  async initialize(): Promise<void>;

  // Returns the cached PlexusConfig (same shape as today's getConfig())
  getConfig(): PlexusConfig;

  // CRUD operations that update both DB and cache
  async saveProvider(slug: string, config: ProviderConfig): Promise<void>;
  async deleteProvider(slug: string, cascade: boolean): Promise<void>;
  async saveAlias(slug: string, config: ModelConfig): Promise<void>;
  async deleteAlias(slug: string): Promise<void>;
  async saveKey(name: string, config: KeyConfig): Promise<void>;
  async deleteKey(name: string): Promise<void>;
  // ... etc for all entities

  // Import from YAML (used during bootstrap only)
  async importFromYaml(yamlContent: string): Promise<void>;
  async importFromAuthJson(jsonContent: string): Promise<void>;

  // Export DB contents as JSON for backup
  async exportConfig(): Promise<PlexusConfigExport>;
}
```

### 2.3 Backward-compatible `getConfig()` shim

To minimize churn across the codebase, the existing `getConfig()` function in `config.ts` will be updated to delegate to `ConfigService.getInstance().getConfig()`. This means most consumers (router, dispatcher, auth, selectors, etc.) need **zero changes** initially.

```typescript
// config.ts (updated)
export function getConfig(): PlexusConfig {
  return ConfigService.getInstance().getConfig();
}
```

---

## Phase 3: Auto-Import on First Launch

### 3.1 Import Logic

In `index.ts` startup sequence, **after** database initialization and migrations:

```
1. Check if providers table is empty (first launch indicator)
2. If empty AND plexus.yaml exists:
   a. Parse and validate plexus.yaml (Zod schema)
   b. Import all providers, models, aliases, keys, user_quotas, mcp_servers, settings via Drizzle ORM
   c. Log: "Imported configuration from plexus.yaml into database"
3. If empty AND auth.json exists:
   a. Parse auth.json
   b. Import all OAuth credentials via Drizzle ORM
   c. Log: "Imported OAuth credentials from auth.json into database"
4. If NOT empty:
   a. Load config from database (normal path)
   b. Log: "Loaded configuration from database"
```

Note: No sentinel value is added to plexus.yaml — the import check is purely based on whether the DB tables are empty, making it safe and idempotent.

### 3.2 Import Mapping (via Drizzle ORM)

**Providers:**
```
providers.<slug> → db.insert(providers).values({ slug, displayName, apiBaseUrl, ... })
providers.<slug>.models (array) → db.insert(providerModels).values([{ providerId, modelName, sortOrder }])
providers.<slug>.models (map) → db.insert(providerModels).values([{ providerId, modelName, pricingConfig, modelType, accessVia }])
providers.<slug>.quota_checker → included in providers insert (quotaCheckerType, quotaCheckerOptions, ...)
```

**Model Aliases:**
```
models.<slug> → db.insert(modelAliases).values({ slug, selector, priority, modelType, ... })
models.<slug>.targets[] → db.insert(modelAliasTargets).values([{ aliasId, providerSlug, modelName, enabled, sortOrder }])
```

**Keys:**
```
keys.<name> → db.insert(apiKeys).values({ name, secret, comment, quotaName })
```

**User Quotas:**
```
user_quotas.<name> → db.insert(userQuotaDefinitions).values({ name, quotaType, limitType, limitValue, duration })
```

**MCP Servers:**
```
mcp_servers.<name> → db.insert(mcpServers).values({ name, upstreamUrl, enabled, headers })
```

**Settings/Policies:**
```
failover, cooldown, rates → db.insert(systemSettings).values([{ key, value }])
```

**OAuth (from auth.json):**
```
<provider>.accounts.<accountId> → db.insert(oauthCredentials).values({ oauthProviderType, accountId, accessToken, refreshToken, expiresAt })
```

---

## Phase 4: Update Backend Consumers

### 4.1 Files That Need Changes

| File | Change Required |
|---|---|
| `config.ts` | Refactor: `getConfig()` delegates to ConfigService; remove all YAML file loading, watching, and `adminKey` handling (now from `ADMIN_KEY` env var) |
| `routes/management/config.ts` | **Major rewrite**: Remove YAML file read/write entirely; all operations go through ConfigService CRUD |
| `routes/management/user-quotas.ts` | Update: Use ConfigRepository for user_quota_definitions table |
| `utils/auth.ts` | Minor: Works via `getConfig()` shim initially |
| `services/oauth-auth-manager.ts` | **Major rewrite**: Store/retrieve OAuth credentials from `oauth_credentials` table; remove all auth.json file I/O |
| `services/quota/quota-scheduler.ts` | No change: Receives `quotas` array via `getConfig()` shim |
| `services/quota/quota-enforcer.ts` | No change: Uses `getConfig()` shim |
| `services/router.ts` | No change: Uses `getConfig()` shim |
| `services/dispatcher.ts` | No change: Uses `getConfig()` shim |
| `services/cooldown-manager.ts` | No change: Uses `getConfig()` shim |
| `services/selectors/*.ts` | No change: Uses `getConfig()` shim |
| `routes/inference/models.ts` | No change: Uses `getConfig()` shim |
| `index.ts` | Update: Remove `loadConfig()`, add ConfigService initialization + auto-import logic; read `ADMIN_KEY` from env |

### 4.2 Management API Changes

**Config Routes (config.ts) — rewritten:**
- `DELETE /v0/management/models/:aliasId` → `ConfigService.deleteAlias(slug)`
- `DELETE /v0/management/models` → `ConfigService.deleteAllAliases()`
- `DELETE /v0/management/providers/:providerId` → `ConfigService.deleteProvider(slug, cascade)`
- MCP CRUD → `ConfigService.saveMcpServer()` / `deleteMcpServer()`

**New Granular Endpoints:**
- `GET /v0/management/providers` → List all providers from DB
- `GET /v0/management/providers/:slug` → Single provider
- `POST /v0/management/providers/:slug` → Create/update provider
- `GET /v0/management/aliases` → List all aliases from DB
- `POST /v0/management/aliases/:slug` → Create/update alias
- `GET /v0/management/keys` → List all keys from DB
- `POST /v0/management/keys/:name` → Create/update key
- `DELETE /v0/management/keys/:name` → Delete key
- `GET /v0/management/system-settings` → Get all system settings
- `PATCH /v0/management/system-settings` → Update system settings

**Export Endpoint:**
- `GET /v0/management/config/export` → Returns full DB contents as structured JSON (providers, aliases, keys, quotas, settings, mcp_servers)

---

## Phase 5: Update Frontend

### 5.1 Frontend API Layer (`lib/api.ts`)

Replace all "fetch YAML → parse → modify → stringify → POST back" patterns with direct JSON API calls.

| Current Method | New Behavior |
|---|---|
| `getProviders()` | `GET /v0/management/providers` → JSON |
| `saveProvider()` | `POST /v0/management/providers/:slug` → JSON |
| `deleteProvider()` | Already dedicated endpoint — no change |
| `getAliases()` | `GET /v0/management/aliases` → JSON |
| `saveAlias()` | `POST /v0/management/aliases/:slug` → JSON |
| `getKeys()` | `GET /v0/management/keys` → JSON |
| `saveKey()` | `POST /v0/management/keys/:name` → JSON |
| `deleteKey()` | `DELETE /v0/management/keys/:name` |
| `getModels()` | `GET /v0/management/providers` → extract provider models from response |
| `getConfig()` | **Removed** (no YAML config endpoint) |
| `saveConfig()` | **Removed** (no YAML config endpoint) |
| `getMcpServers()` | Already dedicated endpoint — no change |
| `getUserQuotas()` | Already dedicated endpoint — no change |
| `saveUserQuota()` | Already dedicated endpoint — no change |
| `deleteUserQuota()` | Already dedicated endpoint — no change |

### 5.2 Config Editor Page

The YAML config editor page (`Config.tsx`) is **removed**. Configuration is managed exclusively through the purpose-built UI pages (Providers, Models, Keys, Quotas, MCP Servers, Settings).

---

## Phase 6: OAuth Auth Manager Migration

### 6.1 Current State
- `OAuthAuthManager` reads/writes `auth.json` directly
- Used at startup and during OAuth token refresh

### 6.2 New State
- `OAuthAuthManager` reads/writes `oauth_credentials` table via `ConfigRepository` using Drizzle ORM
- On first launch, imports from `auth.json` if the `oauth_credentials` table is empty
- Token refresh writes updates back to DB
- `auth.json` is fully removed after migration

---

## Phase 7: Remove File Watcher

Currently, `config.ts` watches `plexus.yaml` for changes and hot-reloads. Since the DB is now the source of truth:

1. Remove `fs.watch()` on `plexus.yaml` entirely
2. The in-memory cache in `ConfigService` is updated immediately on any write operation (no polling needed for single-instance deployments)

---

## Implementation Order

### Step 1: Schema + Migrations
- Create all Drizzle schema files for both SQLite and PostgreSQL (enums, jsonb, bigint timestamps, integer PKs)
- Generate migrations via `drizzle-kit generate` for both dialects
- Verify migrations apply cleanly

### Step 2: ConfigRepository
- Implement the DB abstraction layer using Drizzle ORM throughout
- Unit test CRUD operations

### Step 3: ConfigService + Import
- Implement the in-memory cached service
- Implement YAML import logic (Drizzle ORM inserts, wrapped in transactions)
- Implement `getConfig()` shim
- Test import from example plexus.yaml

### Step 4: Update Startup Flow
- Modify `index.ts`: remove `loadConfig()`, add ConfigService initialization + auto-import
- Read `ADMIN_KEY` from `process.env.ADMIN_KEY`
- Test fresh start (import) and subsequent start (load from DB)

### Step 5: Update Management Routes
- Rewrite `config.ts` routes to use ConfigService
- Add new granular REST endpoints
- Remove YAML GET/POST endpoints

### Step 6: Update OAuth Manager
- Migrate `OAuthAuthManager` to use `oauth_credentials` table via Drizzle ORM
- Add auth.json import logic for first-launch
- Test OAuth flows

### Step 7: Update Frontend
- Remove YAML-fetch-parse-modify-save patterns; replace with JSON API calls
- Remove Config editor page (`Config.tsx`)
- Test all CRUD flows from UI

### Step 8: Cleanup
- Remove YAML file watcher
- Delete `config/plexus.example.yaml` or convert to documentation-only
- Remove all `auth.json` references
- Update documentation

---

## Data Integrity

- Foreign keys with CASCADE deletes for provider→models and alias→targets
- Unique constraints on slugs/names prevent duplicates
- Enum constraints validated at DB layer (CHECK in SQLite, native ENUM in PostgreSQL)
- JSON columns validated at application layer (Zod schemas preserved)
- Transactions for multi-table writes (e.g., importing a full config)
- All DB operations via Drizzle ORM — no raw SQL

---

## Open Questions / Decisions Needed

1. **Encryption for API keys/secrets in DB?** Currently plaintext in YAML. Could add AES encryption keyed off `ADMIN_KEY`, but adds complexity. Recommend: same as current (plaintext) for v1, encrypt in a follow-up.

2. **Config versioning/audit trail?** Could add a `config_changelog` table. Recommend: defer to follow-up.
