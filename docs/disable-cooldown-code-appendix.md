# Disable Cooldown Code Appendix (Full Relevant Code)

Last updated: 2026-02-21 UTC
Redaction policy: secrets are masked as `[REDACTED]`.

This appendix provides the full relevant code blocks for:

- What was used yesterday (historical commits)
- What is active now (current head)
- Runtime config state on AI01 test path (redacted)

---

## A) Historical Code Used Yesterday

## A1. Backend schema support (historical)

Source: `c109b3672bd1aa3865014e832015dd08a00e2dcc:packages/backend/src/config.ts`

```typescript
const ProviderConfigSchema = z.object({
  display_name: z.string().optional(),
  api_base_url: z.union([
    z.string().refine((value) => isValidUrlOrOAuth(value), {
      message: "api_base_url must be a valid URL or oauth://"
    }),
    z.record(z.string())
  ]),
  api_key: z.string().optional(),
  oauth_provider: OAuthProviderSchema.optional(),
  oauth_account: z.string().min(1).optional(),
  enabled: z.boolean().default(true).optional(),
  discount: z.number().min(0).max(1).optional(),
  models: z.union([
    z.array(z.string()),
    z.record(z.string(), ModelProviderConfigSchema)
  ]).optional(),
  headers: z.record(z.string()).optional(),
  extraBody: z.record(z.any()).optional(),
  estimateTokens: z.boolean().optional().default(false),
  disable_cooldown: z.boolean().optional().default(false),
  quota_checker: ProviderQuotaCheckerSchema.optional(),
})
  .refine(
    (data) => !!data.api_key || isOAuthProviderConfig(data),
    { message: "'api_key' must be specified for provider" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_provider,
    { message: "'oauth_provider' must be specified when using oauth://" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_account,
    { message: "'oauth_account' must be specified when using oauth://" }
  );
```

## A2. Backend cooldown bypass helper (historical)

Source: `c109b3672bd1aa3865014e832015dd08a00e2dcc:packages/backend/src/services/dispatcher.ts`

```typescript
private markProviderFailure(route: RouteResult, durationMs?: number): void {
  if (route.config.disable_cooldown === true) {
    logger.info(
      `Cooldown disabled for provider '${route.provider}' model '${route.model}', skipping failure cooldown`
    );
    return;
  }

  CooldownManager.getInstance().markProviderFailure(route.provider, route.model, durationMs);
}
```

Source: `c109b3672bd1aa3865014e832015dd08a00e2dcc:packages/backend/src/services/dispatcher.ts`

```typescript
private async handleProviderError(
  response: Response,
  route: RouteResult,
  errorText: string,
  url?: string,
  headers?: Record<string, string>,
  targetApiType?: string
): Promise<never> {
  logger.error(`Provider error: ${response.status} ${errorText}`);

  if (response.status >= 500 || [401, 403, 408, 429].includes(response.status)) {
    let cooldownDuration: number | undefined;

    if (response.status === 429) {
      const providerTypes = this.extractProviderTypes(route);
      const providerType = providerTypes[0];

      if (providerType) {
        const parsedDuration = CooldownParserRegistry.parseCooldown(
          providerType,
          errorText
        );

        if (parsedDuration) {
          cooldownDuration = parsedDuration;
          logger.info(
            `Parsed cooldown duration: ${cooldownDuration}ms (${cooldownDuration / 1000}s)`
          );
        } else {
          logger.debug(`No cooldown duration parsed from error, using default`);
        }
      }
    }

    this.markProviderFailure(route, cooldownDuration);
  }

  const error = new Error(`Provider failed: ${response.status} ${errorText}`) as any;
  error.routingContext = {
    provider: route.provider,
    targetModel: route.model,
    targetApiType: targetApiType,
    url: url,
    headers: this.sanitizeHeaders(headers || {}),
    statusCode: response.status,
    providerResponse: errorText
  };

  throw error;
}
```

## A3. Frontend mapping (historical)

Source: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a:packages/frontend/src/lib/api.ts`

```typescript
export interface Provider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  oauthAccount?: string;
  enabled: boolean;
  disableCooldown?: boolean;
  estimateTokens?: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
  models?: string[] | Record<string, any>;
  quotaChecker?: {
    type?: string;
    enabled: boolean;
    intervalMinutes: number;
    options?: Record<string, unknown>;
  };
}
```

Source: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a:packages/frontend/src/lib/api.ts`

```typescript
interface PlexusConfig {
    providers: Record<string, {
        type?: string | string[];
        api_key?: string;
        oauth_provider?: string;
        oauth_account?: string;
        api_base_url?: string | Record<string, string>;
        display_name?: string;
        models?: string[] | Record<string, any>;
        enabled?: boolean;
        disable_cooldown?: boolean;
        estimateTokens?: boolean;
        discount?: number;
        headers?: Record<string, string>;
        extraBody?: Record<string, any>;
        quota_checker?: {
            type?: string;
            enabled?: boolean;
            intervalMinutes?: number;
            options?: Record<string, unknown>;
        };
    }>;
    models?: Record<string, any>;
    keys?: Record<string, KeyConfig>;
    quotas?: QuotaConfig[];
}
```

Source: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a:packages/frontend/src/lib/api.ts`

```typescript
// getProviders mapping
return {
    id: key,
    name: val.display_name || key,
    type: inferredTypes,
    apiBaseUrl: val.api_base_url,
    apiKey: val.api_key || '',
    oauthProvider: val.oauth_provider,
    oauthAccount: val.oauth_account,
    enabled: val.enabled !== false,
    disableCooldown: val.disable_cooldown === true,
    estimateTokens: val.estimateTokens || false,
    discount: val.discount,
    headers: val.headers,
    extraBody: val.extraBody,
    models: normalizedModels,
    quotaChecker: normalizeProviderQuotaChecker(val.quota_checker)
};
```

Source: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a:packages/frontend/src/lib/api.ts`

```typescript
// saveProviders mapping
newProvidersObj[p.id] = {
    ...existing,
    type: p.type,
    api_key: p.apiKey,
    ...(p.oauthProvider && { oauth_provider: p.oauthProvider }),
    ...(p.oauthAccount && { oauth_account: p.oauthAccount }),
    disable_cooldown: p.disableCooldown === true,
    api_base_url: p.apiBaseUrl,
    display_name: p.name,
    discount: p.discount,
    headers: p.headers,
    extraBody: p.extraBody,
    models: p.models,
    quota_checker: p.quotaChecker?.type
      ? {
          type: p.quotaChecker.type,
          enabled: p.quotaChecker.enabled,
          intervalMinutes: Math.max(1, p.quotaChecker.intervalMinutes || 30)
        }
      : undefined
};
```

Source: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a:packages/frontend/src/lib/api.ts`

```typescript
// saveProvider mapping
config.providers[provider.id] = {
    ...(shouldIncludeType && { type: provider.type }),
    api_key: provider.apiKey,
    ...(provider.oauthProvider && { oauth_provider: provider.oauthProvider }),
    ...(provider.oauthAccount && { oauth_account: provider.oauthAccount }),
    disable_cooldown: provider.disableCooldown === true,
    api_base_url: provider.apiBaseUrl,
    display_name: provider.name,
    estimateTokens: provider.estimateTokens,
    discount: provider.discount,
    headers: provider.headers,
    extraBody: provider.extraBody,
    models: provider.models,
    enabled: provider.enabled,
    quota_checker: provider.quotaChecker?.type
      ? {
          type: provider.quotaChecker.type,
          enabled: provider.quotaChecker.enabled,
          intervalMinutes: Math.max(1, provider.quotaChecker.intervalMinutes || 30),
          options: provider.quotaChecker.options
        }
      : undefined
};
```

---

## B) Current Active Code (Current Head `9917732`)

## B1. Frontend still maps `disable_cooldown`

Source: `packages/frontend/src/lib/api.ts`

```typescript
export interface Provider {
  id: string;
  name: string;
  type: string | string[];
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  oauthAccount?: string;
  enabled: boolean;
  disableCooldown?: boolean;
  estimateTokens?: boolean;
  discount?: number;
  headers?: Record<string, string>;
  extraBody?: Record<string, any>;
  models?: string[] | Record<string, any>;
  quotaChecker?: {
    type?: string;
    enabled: boolean;
    intervalMinutes: number;
    options?: Record<string, unknown>;
  };
}
```

Source: `packages/frontend/src/lib/api.ts`

```typescript
interface PlexusConfig {
    providers: Record<string, {
        type?: string | string[];
        api_key?: string;
        oauth_provider?: string;
        oauth_account?: string;
        api_base_url?: string | Record<string, string>;
        display_name?: string;
        models?: string[] | Record<string, any>;
        enabled?: boolean;
        disable_cooldown?: boolean;
        estimateTokens?: boolean;
        discount?: number;
        headers?: Record<string, string>;
        extraBody?: Record<string, any>;
        quota_checker?: {
            type?: string;
            enabled?: boolean;
            intervalMinutes?: number;
            options?: Record<string, unknown>;
        };
    }>;
}
```

## B2. Backend current schema block (no `disable_cooldown` field)

Source: `packages/backend/src/config.ts`

```typescript
const ProviderConfigSchema = z.object({
  display_name: z.string().optional(),
  api_base_url: z.union([
    z.string().refine((value) => isValidUrlOrOAuth(value), {
      message: "api_base_url must be a valid URL or oauth://"
    }),
    z.record(z.string())
  ]),
  api_key: z.string().optional(),
  oauth_provider: OAuthProviderSchema.optional(),
  oauth_account: z.string().min(1).optional(),
  enabled: z.boolean().default(true).optional(),
  discount: z.number().min(0).max(1).optional(),
  models: z.union([
    z.array(z.string()),
    z.record(z.string(), ModelProviderConfigSchema)
  ]).optional(),
  headers: z.record(z.string()).optional(),
  extraBody: z.record(z.any()).optional(),
  estimateTokens: z.boolean().optional().default(false),
  quota_checker: ProviderQuotaCheckerSchema.optional(),
})
  .refine(
    (data) => !!data.api_key || isOAuthProviderConfig(data),
    { message: "'api_key' must be specified for provider" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_provider,
    { message: "'oauth_provider' must be specified when using oauth://" }
  )
  .refine(
    (data) => !isOAuthProviderConfig(data) || !!data.oauth_account,
    { message: "'oauth_account' must be specified when using oauth://" }
  );
```

## B3. Backend current cooldown path

Source: `packages/backend/src/services/dispatcher.ts`

```typescript
private async handleProviderError(
  response: Response,
  route: RouteResult,
  errorText: string,
  url?: string,
  headers?: Record<string, string>,
  targetApiType?: string
): Promise<never> {
  logger.error(`Provider error: ${response.status} ${errorText}`);

  const cooldownManager = CooldownManager.getInstance();

  if (response.status >= 500 || [401, 403, 408, 429].includes(response.status)) {
    let cooldownDuration: number | undefined;

    if (response.status === 429) {
      const providerTypes = this.extractProviderTypes(route);
      const providerType = providerTypes[0];

      if (providerType) {
        const parsedDuration = CooldownParserRegistry.parseCooldown(
          providerType,
          errorText
        );

        if (parsedDuration) {
          cooldownDuration = parsedDuration;
          logger.info(
            `Parsed cooldown duration: ${cooldownDuration}ms (${cooldownDuration / 1000}s)`
          );
        } else {
          logger.debug(`No cooldown duration parsed from error, using default`);
        }
      }
    }

    cooldownManager.markProviderFailure(route.provider, route.model, cooldownDuration);
  }

  const error = new Error(`Provider failed: ${response.status} ${errorText}`) as any;
  error.routingContext = {
    provider: route.provider,
    targetModel: route.model,
    targetApiType: targetApiType,
    url: url,
    headers: this.sanitizeHeaders(headers || {}),
    statusCode: response.status,
    providerResponse: errorText
  };

  throw error;
}
```

Source: `packages/backend/src/services/cooldown-manager.ts`

```typescript
public async filterHealthyTargets(targets: Target[]): Promise<Target[]> {
    const healthyTargets: Target[] = [];
    
    for (const target of targets) {
        const isHealthy = await this.isProviderHealthy(target.provider, target.model);
        if (isHealthy) {
            healthyTargets.push(target);
        }
    }
    
    return healthyTargets;
}
```

Source: `packages/backend/src/services/router.ts`

```typescript
let healthyTargets = await CooldownManager.getInstance().filterHealthyTargets(enabledTargets);

if (healthyTargets.length < enabledTargets.length) {
    const filteredCount = enabledTargets.length - healthyTargets.length;
    logger.warn(`Router: ${filteredCount} target(s) for '${modelName}' were filtered out due to cooldowns.`);
}
```

---

## C) AI01 Runtime Config Excerpt (Redacted)

Source (read-only): `/home/user001/plexus/plexus.yaml` mounted into test container as `/app/config/plexus.yaml`

```yaml
providers:
  olamma cloud:
    api_key: "[REDACTED]"
    api_base_url:
      chat: https://ollama.com/v1
    # disable_cooldown is currently missing

  plasma:
    api_key: "[REDACTED]"
    disable_cooldown: true
    api_base_url:
      chat: http://100.81.234.111:11434/v1

  UCS03:
    api_key: "[REDACTED]"
    disable_cooldown: true
    api_base_url:
      chat: http://100.99.118.48:11434/v1
```

---

## D) Provenance Summary

- Historical backend behavior commit: `c109b3672bd1aa3865014e832015dd08a00e2dcc`
- Historical frontend mapping commit: `f0daf36489597a16ca8d5208dfa9fff1ebb7cf8a`
- Current active merged head: `9917732269dbb6d9bfeb9c10f0aefa1711c28961`

This document is intentionally limited to full relevant code for `disable_cooldown` behavior and verification context.
