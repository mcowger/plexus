import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import {
  ProviderConfigSchema,
  ModelConfigSchema,
  KeyConfigSchema,
  McpServerConfigSchema,
  CompactionConfigSchema,
  normalizeKeyConfig,
} from '../../config';
import { validateRawProviderSlug } from '../../services/raw-passthrough';
import { ConfigService } from '../../services/config-service';
import { DebugManager } from '../../services/debug-manager';
import { isValidIpRule } from '../../utils/ip-match';
import { getCheckerDefinitions } from '../../services/quota/checker-registry';
import { UsageStorageService } from '../../services/usage-storage';
import { validateServerName } from '../../services/mcp-proxy/mcp-proxy-service';
import { mcpProcessManager } from '../../services/mcp-local/mcp-process-manager';
import { VisionDescriptorService } from '../../services/vision-descriptor-service';
import type { GpuParams, ModelArchitecture } from '@plexus/shared';
import { DEFAULT_GPU_PARAMS } from '@plexus/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeCompactionPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
      continue;
    }

    if ((key === 'native' || key === 'headroom') && isRecord(value)) {
      const currentNested = isRecord(merged[key]) ? (merged[key] as Record<string, unknown>) : {};
      const nested = mergeCompactionPatch(currentNested, value);
      if (Object.keys(nested).length === 0) {
        delete merged[key];
      } else {
        merged[key] = nested;
      }
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

/**
 * Build a map of provider slug -> resolved GpuParams from current config.
 * Used by recalculateEnergyIfChanged to pass concrete GPU params
 * instead of profile names.
 */
function buildProviderGpuParamsMap(
  configService: ConfigService
): Record<string, GpuParams> | undefined {
  const config = configService.getConfig();
  if (!config?.providers) return undefined;

  const map: Record<string, GpuParams> = {};
  let hasAny = false;
  for (const [slug, provider] of Object.entries(config.providers)) {
    if (provider.gpu_ram_gb != null || provider.gpu_bandwidth_tb_s != null) {
      map[slug] = {
        ram_gb: provider.gpu_ram_gb ?? DEFAULT_GPU_PARAMS.ram_gb,
        bandwidth_tb_s: provider.gpu_bandwidth_tb_s ?? DEFAULT_GPU_PARAMS.bandwidth_tb_s,
        flops_tflop: provider.gpu_flops_tflop ?? DEFAULT_GPU_PARAMS.flops_tflop,
        power_draw_watts: provider.gpu_power_draw_watts ?? DEFAULT_GPU_PARAMS.power_draw_watts,
      };
      hasAny = true;
    }
  }
  return hasAny ? map : undefined;
}

/**
 * Shared helper: recalculate energy usage for an alias if model_architecture was provided.
 * Used by both PUT and PATCH alias handlers to avoid duplication.
 */
async function recalculateEnergyIfChanged(
  slug: string,
  model_architecture: ModelArchitecture | undefined,
  usageStorage?: UsageStorageService,
  providerGpuParams?: Record<string, GpuParams>
) {
  if (model_architecture && usageStorage) {
    try {
      const updated = await usageStorage.recalculateEnergyForAlias(
        slug,
        model_architecture,
        providerGpuParams
      );
      logger.info(`Recalculated energy for ${updated} requests for alias '${slug}'`);
    } catch (recalcError) {
      // Don't fail the save if recalculation fails, just log the error
      logger.error(`Failed to recalculate energy for alias '${slug}'`, recalcError);
    }
  }
}

export async function registerConfigRoutes(
  fastify: FastifyInstance,
  usageStorage?: UsageStorageService
) {
  const configService = ConfigService.getInstance();

  // ─── Config Status ────────────────────────────────────────────────

  fastify.get('/v0/management/config/status', async (_request, reply) => {
    try {
      // No longer relevant - Plexus no longer supports YAML config
      return reply.send({});
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Config Export ────────────────────────────────────────────────

  fastify.get('/v0/management/config', async (_request, reply) => {
    try {
      const config = configService.getConfig();
      return reply.send(config);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/v0/management/config/export', async (_request, reply) => {
    try {
      const exported = await configService.exportConfig();
      return reply.send(exported);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Providers ────────────────────────────────────────────────────

  fastify.get('/v0/management/providers', async (_request, reply) => {
    try {
      const providers = await configService.getRepository().getAllProviders();
      return reply.send(providers);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.get('/v0/management/providers/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    try {
      const provider = await configService.getRepository().getProvider(slug);
      if (!provider) {
        return reply.code(404).send({ error: `Provider '${slug}' not found` });
      }
      return reply.send(provider);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // PUT — full create-or-replace, body must be a complete valid ProviderConfig
  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.put('/v0/management/providers/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    const result = ProviderConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
    }
    if (result.data.raw_passthrough?.enabled && !validateRawProviderSlug(slug)) {
      return reply.code(400).send({
        error: 'Raw passthrough requires a single slug-safe provider ID',
      });
    }
    try {
      await configService.saveProvider(slug, result.data);
      logger.debug(`Provider '${slug}' saved via API (PUT)`);
      return reply.send({ success: true, slug });
    } catch (e: any) {
      logger.error(`Failed to save provider '${slug}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH — partial update; merges into existing config then validates the result
  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.patch('/v0/management/providers/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    try {
      const existing = await configService.getRepository().getProvider(slug);
      if (!existing) {
        return reply.code(404).send({ error: `Provider '${slug}' not found` });
      }
      const merged = { ...existing, ...body };
      const result = ProviderConfigSchema.safeParse(merged);
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
      }
      if (result.data.raw_passthrough?.enabled && !validateRawProviderSlug(slug)) {
        return reply.code(400).send({
          error: 'Raw passthrough requires a single slug-safe provider ID',
        });
      }
      await configService.saveProvider(slug, result.data);
      logger.debug(`Provider '${slug}' updated via API (PATCH)`);
      return reply.send({ success: true, slug });
    } catch (e: any) {
      logger.error(`Failed to patch provider '${slug}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Using wildcard to support providerIds containing '/' (e.g. "provider/model")
  fastify.delete('/v0/management/providers/*', async (request, reply) => {
    const providerId = (request.params as { '*': string })['*'];
    const query = request.query as { cascade?: string };
    const cascade = query.cascade === 'true';

    try {
      await configService.deleteProvider(providerId, cascade);
      logger.debug(`Provider '${providerId}' deleted via API${cascade ? ' (cascade)' : ''}`);
      return reply.send({ success: true, provider: providerId });
    } catch (e: any) {
      logger.error(`Failed to delete provider '${providerId}'`, e);
      return reply.code(500).send({ error: e.message || 'Internal server error' });
    }
  });

  // ─── Model Aliases ────────────────────────────────────────────────

  fastify.get('/v0/management/aliases', async (_request, reply) => {
    try {
      const aliases = await configService.getRepository().getAllAliases();
      return reply.send(aliases);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.get('/v0/management/aliases/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    try {
      const alias = await configService.getRepository().getAlias(slug);
      if (!alias) {
        return reply.code(404).send({ error: `Alias '${slug}' not found` });
      }
      return reply.send({ slug, ...alias });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // PUT — full create-or-replace with Zod validation
  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.put('/v0/management/aliases/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    const result = ModelConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
    }
    try {
      await configService.saveAlias(slug, result.data);

      await recalculateEnergyIfChanged(
        slug,
        result.data.model_architecture,
        usageStorage,
        buildProviderGpuParamsMap(configService)
      );

      logger.debug(`Model alias '${slug}' saved via API (PUT)`);
      return reply.send({ success: true, slug });
    } catch (e: any) {
      logger.error(`Failed to save model alias '${slug}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH — partial update; merges into existing alias then validates
  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.patch('/v0/management/aliases/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    try {
      const existing = await configService.getRepository().getAlias(slug);
      if (!existing) {
        return reply.code(404).send({ error: `Alias '${slug}' not found` });
      }
      const merged = { ...existing, ...body };
      const result = ModelConfigSchema.safeParse(merged);
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
      }
      await configService.saveAlias(slug, result.data);

      await recalculateEnergyIfChanged(
        slug,
        result.data.model_architecture,
        usageStorage,
        buildProviderGpuParamsMap(configService)
      );

      logger.debug(`Model alias '${slug}' updated via API (PATCH)`);
      return reply.send({ success: true, slug });
    } catch (e: any) {
      logger.error(`Failed to patch model alias '${slug}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Using wildcard to support aliasIds containing '/' (e.g. "provider/model")
  fastify.delete('/v0/management/models/*', async (request, reply) => {
    const aliasId = (request.params as { '*': string })['*'];

    try {
      await configService.deleteAlias(aliasId);
      logger.debug(`Model alias '${aliasId}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete model alias '${aliasId}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/models', async (_request, reply) => {
    try {
      const deletedCount = await configService.deleteAllAliases();
      logger.debug(`Deleted all model aliases (${deletedCount}) via API`);
      return reply.send({ success: true, deletedCount });
    } catch (e: any) {
      logger.error('Failed to delete all model aliases', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── API Keys ─────────────────────────────────────────────────────

  fastify.get('/v0/management/keys', async (_request, reply) => {
    try {
      const keys = await configService.getRepository().getAllKeys();
      return reply.send(keys);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const keys = await configService.getRepository().getAllKeys();
      const key = keys[name];
      if (!key) {
        return reply.code(404).send({ error: `API key '${name}' not found` });
      }
      return reply.send({ name, ...key });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // PUT — full create-or-replace with Zod validation
  fastify.put('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (name.includes('*')) {
      return reply
        .code(400)
        .send({ error: "Key name cannot contain '*' (reserved for the shared-quota bucket)" });
    }
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    const existing = await configService.getRepository().getAllKeys();
    if (
      existing[name] &&
      ('expiresInMinutes' in body || 'expiresAt' in body || 'disabledAt' in body)
    ) {
      return reply.code(400).send({ error: 'Key expiry cannot be changed after creation' });
    }
    if ('expiresAt' in body || 'disabledAt' in body) {
      return reply.code(400).send({ error: 'Expiry timestamps are managed by Plexus' });
    }
    const result = KeyConfigSchema.safeParse(body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
    }
    try {
      await configService.saveKey(name, normalizeKeyConfig(result.data));
      logger.debug(`API key '${name}' saved via API (PUT)`);
      return reply.send({ success: true, name });
    } catch (e: any) {
      logger.error(`Failed to save API key '${name}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    if ('expiresInMinutes' in body || 'expiresAt' in body || 'disabledAt' in body) {
      return reply.code(400).send({ error: 'Key expiry cannot be changed after creation' });
    }

    try {
      const keys = await configService.getRepository().getAllKeys();
      const existing = keys[name];
      if (!existing) {
        return reply.code(404).send({ error: `API key '${name}' not found` });
      }
      // Normalize a legacy `quota` field on the incoming body BEFORE merging,
      // so a legacy-format PATCH replaces the key's `quotas` instead of being
      // shadowed by the existing config's `quotas`.
      const merged = { ...existing, ...normalizeKeyConfig(body) };
      const result = KeyConfigSchema.safeParse(merged);
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
      }
      await configService.saveKey(name, result.data);
      logger.debug(`API key '${name}' updated via API (PATCH)`);
      return reply.send({ success: true, name });
    } catch (e: any) {
      logger.error(`Failed to patch API key '${name}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      await configService.deleteKey(name);
      logger.debug(`API key '${name}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete API key '${name}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/v0/management/keys/:name/disable', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const disabled = await configService.disableTimeBoundKey(name);
      if (!disabled) {
        return reply.code(400).send({ error: 'Only time-bound keys can be disabled' });
      }
      logger.debug(`Time-bound API key '${name}' disabled via API`);
      return reply.send({ success: true, name });
    } catch (e: any) {
      logger.error(`Failed to disable API key '${name}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── System Settings ──────────────────────────────────────────────

  fastify.get('/v0/management/system-settings', async (_request, reply) => {
    try {
      const settings = await configService.getAllSettings();
      return reply.send(settings);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/system-settings', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    // `default_quotas` is the one system setting with referential integrity:
    // every name must exist in `user_quotas`, mirroring the membership checks
    // on /quota/clear and /quota/recompute (the runtime only skip-and-warns on
    // dangling names, silently enforcing nothing). `null` clears the setting.
    if ('default_quotas' in body && body.default_quotas != null) {
      const dq = body.default_quotas;
      if (!Array.isArray(dq) || dq.some((v) => typeof v !== 'string')) {
        return reply.code(400).send({
          error: {
            message: `'default_quotas' must be an array of quota names`,
            type: 'invalid_request_error',
          },
        });
      }
      const defined = await configService.getRepository().getAllUserQuotas();
      const unknown = dq.filter((name) => !Object.hasOwn(defined, name));
      if (unknown.length > 0) {
        return reply.code(400).send({
          error: {
            message: `Unknown quota name(s) in 'default_quotas': ${unknown.join(', ')}. Quotas must be defined in user_quotas first.`,
            type: 'invalid_request_error',
          },
        });
      }
    }

    try {
      await configService.setSettingsBulk(body);
      logger.debug('System settings updated via API');
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error('Failed to update system settings', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Failover Policy ─────────────────────────────────────────────

  fastify.get('/v0/management/config/failover', async (_request, reply) => {
    try {
      const failover = await configService.getRepository().getFailoverPolicy();
      return reply.send(failover);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/failover', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      // Read current values, merge with updates, and write back
      const current = await configService.getRepository().getFailoverPolicy();
      const merged = { ...current, ...body };

      if (body.enabled !== undefined) {
        await configService.setSetting('failover.enabled', merged.enabled);
      }
      if (body.retryableStatusCodes !== undefined) {
        await configService.setSetting(
          'failover.retryableStatusCodes',
          merged.retryableStatusCodes
        );
      }
      if (body.retryableErrors !== undefined) {
        await configService.setSetting('failover.retryableErrors', merged.retryableErrors);
      }

      // Return the final merged state
      const updated = await configService.getRepository().getFailoverPolicy();
      logger.debug('Failover policy updated via API');
      return reply.send(updated);
    } catch (e: any) {
      logger.error('Failed to patch failover config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Capture Trace on Error ──────────────────────────────────────
  // Persisted admin toggle. When enabled, DebugManager captures traces for
  // every request and persists them only when a request writes an inference
  // error or triggers a cooldown, even if global/per-key debug is off.

  fastify.get('/v0/management/config/capture-trace-on-error', async (_request, reply) => {
    try {
      const enabled = await configService.getRepository().getCaptureTraceOnError();
      return reply.send({ enabled });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/capture-trace-on-error', async (request, reply) => {
    const body = request.body as { enabled?: unknown } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be a boolean' });
    }

    try {
      // Persist to the database, then mirror to the in-memory DebugManager so
      // the change takes effect immediately without a restart.
      await configService.setSetting('debug.captureOnError', body.enabled);
      DebugManager.getInstance().setCaptureOnError(body.enabled);
      logger.debug('Capture-trace-on-error updated via API');
      return reply.send({ enabled: body.enabled });
    } catch (e: any) {
      logger.error('Failed to patch capture-trace-on-error config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Trusted Proxies ──────────────────────────────────────────────
  fastify.get('/v0/management/config/trusted-proxies', async (_request, reply) => {
    try {
      const trustedProxies = await configService.getRepository().getTrustedProxies();
      return reply.send({ trustedProxies });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/trusted-proxies', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    const value = (body as { trustedProxies?: unknown }).trustedProxies;
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return reply.code(400).send({ error: 'trustedProxies must be an array of strings' });
    }

    const normalized = (value as string[]).map((v) => v.trim()).filter(Boolean);
    const invalid = normalized.find((entry) => !isValidIpRule(entry));
    if (invalid) {
      return reply.code(400).send({
        error: `Invalid IP rule: ${invalid}. Use IPv4/IPv6, CIDR (a.b.c.d/n, ::/n), or a range (a.b.c.d-N or addr-addr).`,
      });
    }

    try {
      await configService.setSetting('trustedProxies', normalized);
      const trustedProxies = await configService.getRepository().getTrustedProxies();
      logger.debug('Trusted proxies updated via API');
      return reply.send({ trustedProxies });
    } catch (e: any) {
      logger.error('Failed to patch trusted-proxies config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Cooldown Policy ──────────────────────────────────────────────

  fastify.get('/v0/management/config/cooldown', async (_request, reply) => {
    try {
      const cooldown = await configService.getRepository().getCooldownPolicy();
      return reply.send(cooldown);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/cooldown', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      // Read current values, merge with updates, and write back
      const current = await configService.getRepository().getCooldownPolicy();
      const merged = { ...current, ...body };

      // Validate cooldown values (minimum 0.1 minutes / 6 seconds)
      if (body.initialMinutes !== undefined) {
        const val = Number(merged.initialMinutes);
        if (!Number.isFinite(val) || val < 0.1) {
          return reply.code(400).send({ error: 'initialMinutes must be at least 0.1' });
        }
        await configService.setSetting('cooldown.initialMinutes', val);
      }
      if (body.maxMinutes !== undefined) {
        const val = Number(merged.maxMinutes);
        if (!Number.isFinite(val) || val < 0.1) {
          return reply.code(400).send({ error: 'maxMinutes must be at least 0.1' });
        }
        await configService.setSetting('cooldown.maxMinutes', val);
      }

      // Return the final merged state
      const updated = await configService.getRepository().getCooldownPolicy();
      logger.debug('Cooldown policy updated via API');
      return reply.send(updated);
    } catch (e: any) {
      logger.error('Failed to patch cooldown config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Exploration Rate ─────────────────────────────────────────────

  fastify.get('/v0/management/config/exploration-rate', async (_request, reply) => {
    try {
      const performanceExplorationRate = await configService.getSetting<number>(
        'performanceExplorationRate',
        0.05
      );
      const latencyExplorationRate = await configService.getSetting<number>(
        'latencyExplorationRate',
        0.05
      );
      const e2ePerformanceExplorationRate = await configService.getSetting<number>(
        'e2ePerformanceExplorationRate',
        0.05
      );
      return reply.send({
        performanceExplorationRate,
        latencyExplorationRate,
        e2ePerformanceExplorationRate,
      });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/exploration-rate', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      if (body.performanceExplorationRate !== undefined) {
        const value = Number(body.performanceExplorationRate);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          return reply
            .code(400)
            .send({ error: 'performanceExplorationRate must be a number between 0 and 1' });
        }
        await configService.setSetting('performanceExplorationRate', value);
      }
      if (body.latencyExplorationRate !== undefined) {
        const value = Number(body.latencyExplorationRate);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          return reply
            .code(400)
            .send({ error: 'latencyExplorationRate must be a number between 0 and 1' });
        }
        await configService.setSetting('latencyExplorationRate', value);
      }
      if (body.e2ePerformanceExplorationRate !== undefined) {
        const value = Number(body.e2ePerformanceExplorationRate);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          return reply
            .code(400)
            .send({ error: 'e2ePerformanceExplorationRate must be a number between 0 and 1' });
        }
        await configService.setSetting('e2ePerformanceExplorationRate', value);
      }

      const performanceExplorationRate = await configService.getSetting<number>(
        'performanceExplorationRate',
        0.05
      );
      const latencyExplorationRate = await configService.getSetting<number>(
        'latencyExplorationRate',
        0.05
      );
      const e2ePerformanceExplorationRate = await configService.getSetting<number>(
        'e2ePerformanceExplorationRate',
        0.05
      );
      logger.debug('Exploration rate settings updated via API');
      return reply.send({
        performanceExplorationRate,
        latencyExplorationRate,
        e2ePerformanceExplorationRate,
      });
    } catch (e: any) {
      logger.error('Failed to patch exploration rate config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Background Exploration ──────────────────────────────────────

  fastify.get('/v0/management/config/background-exploration', async (_request, reply) => {
    try {
      const cfg = await configService.getRepository().getBackgroundExplorationConfig();
      return reply.send(cfg);
    } catch (e: any) {
      logger.error('Failed to read background-exploration config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/background-exploration', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') {
          return reply.code(400).send({ error: 'enabled must be a boolean' });
        }
        await configService.setSetting('backgroundExploration.enabled', body.enabled);
      }
      if (body.stalenessThresholdSeconds !== undefined) {
        const val = Number(body.stalenessThresholdSeconds);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 1) {
          return reply
            .code(400)
            .send({ error: 'stalenessThresholdSeconds must be an integer >= 1' });
        }
        await configService.setSetting('backgroundExploration.stalenessThresholdSeconds', val);
      }
      if (body.workerConcurrency !== undefined) {
        const val = Number(body.workerConcurrency);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 1 || val > 16) {
          return reply
            .code(400)
            .send({ error: 'workerConcurrency must be an integer between 1 and 16' });
        }
        await configService.setSetting('backgroundExploration.workerConcurrency', val);
      }

      const updated = await configService.getRepository().getBackgroundExplorationConfig();
      logger.debug('Background exploration config updated via API');
      return reply.send(updated);
    } catch (e: any) {
      logger.error('Failed to patch background-exploration config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Timeout Config ───────────────────────────────────────────────

  fastify.get('/v0/management/config/timeout', async (_request, reply) => {
    try {
      const timeout = await configService.getRepository().getTimeoutConfig();
      return reply.send(timeout);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/timeout', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      if (body.defaultSeconds !== undefined) {
        const val = Number(body.defaultSeconds);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 1 || val > 3600) {
          return reply
            .code(400)
            .send({ error: 'defaultSeconds must be an integer between 1 and 3600' });
        }
        await configService.setSetting('timeout.defaultSeconds', val);
      }

      const updated = await configService.getRepository().getTimeoutConfig();
      logger.debug('Timeout config updated via API');
      return reply.send(updated);
    } catch (e: any) {
      logger.error('Failed to patch timeout config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Stall Config ──────────────────────────────────────────────────

  fastify.get('/v0/management/config/stall', async (_request, reply) => {
    try {
      const stall = await configService.getRepository().getStallConfig();
      return reply.send(stall);
    } catch (e: any) {
      logger.error('Failed to read stall config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/stall', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    try {
      if (body.ttfbSeconds !== undefined) {
        if (body.ttfbSeconds === null) {
          await configService.setSetting('stall.ttfbSeconds', null);
        } else {
          const val = Number(body.ttfbSeconds);
          if (!Number.isFinite(val) || val < 5 || val > 120) {
            return reply
              .code(400)
              .send({ error: 'ttfbSeconds must be null or a number between 5 and 120' });
          }
          await configService.setSetting('stall.ttfbSeconds', val);
        }
      }
      if (body.ttfbBytes !== undefined) {
        const val = Number(body.ttfbBytes);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 50 || val > 10000) {
          return reply
            .code(400)
            .send({ error: 'ttfbBytes must be an integer between 50 and 10000' });
        }
        await configService.setSetting('stall.ttfbBytes', val);
      }
      if (body.minBytesPerSecond !== undefined) {
        if (body.minBytesPerSecond === null) {
          await configService.setSetting('stall.minBytesPerSecond', null);
        } else {
          const val = Number(body.minBytesPerSecond);
          if (!Number.isFinite(val) || !Number.isInteger(val) || val < 50 || val > 5000) {
            return reply
              .code(400)
              .send({ error: 'minBytesPerSecond must be null or an integer between 50 and 5000' });
          }
          await configService.setSetting('stall.minBytesPerSecond', val);
        }
      }
      if (body.windowSeconds !== undefined) {
        const val = Number(body.windowSeconds);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 3 || val > 30) {
          return reply
            .code(400)
            .send({ error: 'windowSeconds must be an integer between 3 and 30' });
        }
        await configService.setSetting('stall.windowSeconds', val);
      }
      if (body.gracePeriodSeconds !== undefined) {
        const val = Number(body.gracePeriodSeconds);
        if (!Number.isFinite(val) || !Number.isInteger(val) || val < 0 || val > 120) {
          return reply
            .code(400)
            .send({ error: 'gracePeriodSeconds must be an integer between 0 and 120' });
        }
        await configService.setSetting('stall.gracePeriodSeconds', val);
      }
      if (body.stallCooldown !== undefined) {
        if (typeof body.stallCooldown !== 'boolean') {
          return reply.code(400).send({ error: 'stallCooldown must be a boolean' });
        }
        await configService.setSetting('stall.stallCooldown', body.stallCooldown);
      }

      const updated = await configService.getRepository().getStallConfig();
      logger.debug('Stall config updated via API');
      return reply.send(updated);
    } catch (e: any) {
      logger.error('Failed to patch stall config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Compaction Config ────────────────────────────────────────────

  fastify.get('/v0/management/config/compaction', async (_request, reply) => {
    try {
      const compaction = await configService.getRepository().getCompactionConfig();
      return reply.send(compaction ?? {});
    } catch (e: any) {
      logger.error('Failed to get compaction config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/compaction', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    try {
      const current = (await configService.getRepository().getCompactionConfig()) ?? {};
      const merged = mergeCompactionPatch(current as Record<string, unknown>, body);
      const parsed = CompactionConfigSchema.safeParse(merged);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid compaction config', details: parsed.error.issues });
      }
      await configService.setSetting('compaction', parsed.data);
      return reply.send(parsed.data);
    } catch (e: any) {
      logger.error('Failed to patch compaction config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Vision Fallthrough ───────────────────────────────────────────

  fastify.get('/v0/management/config/vision-fallthrough', async (_request, reply) => {
    try {
      const vf = await configService.getSetting('vision_fallthrough', {});
      return reply.send(vf);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/vision-fallthrough', async (request, reply) => {
    try {
      const updates = request.body as Record<string, unknown> | null;
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return reply.code(400).send({ error: 'Object body is required' });
      }
      const current = await configService.getSetting<any>('vision_fallthrough', {});
      const merged = { ...current, ...updates };
      await configService.setSetting('vision_fallthrough', merged);
      return reply.send(merged);
    } catch (e: any) {
      logger.error('Failed to patch vision-fallthrough config', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Vision Descriptor Cache ──────────────────────────────────────

  fastify.post('/v0/management/cache/vision-descriptor/clear', async (_request, reply) => {
    VisionDescriptorService.clearCache();
    return reply.send({ success: true, message: 'Vision descriptor cache cleared.' });
  });

  // ─── MCP Servers ──────────────────────────────────────────────────

  fastify.get('/v0/management/mcp-servers', async (_request, reply) => {
    try {
      const servers = await configService.getRepository().getAllMcpServers();
      return reply.send(servers);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };

    try {
      const servers = await configService.getRepository().getAllMcpServers();
      const server = servers[serverName];
      if (!server) {
        return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
      }
      return reply.send({ name: serverName, ...server });
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };

    if (!validateServerName(serverName)) {
      return reply.code(400).send({
        error:
          'Invalid server name. Must be a non-reserved slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)',
      });
    }

    const result = McpServerConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
    }

    try {
      await configService.saveMcpServer(serverName, result.data);
      logger.debug(`MCP server '${serverName}' saved via API (PUT)`);
      return reply.send({ success: true, name: serverName });
    } catch (e: any) {
      logger.error(`Failed to save MCP server '${serverName}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }

    if (!validateServerName(serverName)) {
      return reply.code(400).send({
        error:
          'Invalid server name. Must be a non-reserved slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)',
      });
    }

    try {
      const servers = await configService.getRepository().getAllMcpServers();
      const existing = servers[serverName];
      if (!existing) {
        return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
      }
      const merged = { ...existing, ...body };
      const result = McpServerConfigSchema.safeParse(merged);
      if (!result.success) {
        return reply.code(400).send({ error: 'Validation failed', details: result.error.issues });
      }
      await configService.saveMcpServer(serverName, result.data);
      logger.debug(`MCP server '${serverName}' updated via API (PATCH)`);
      return reply.send({ success: true, name: serverName });
    } catch (e: any) {
      logger.error(`Failed to patch MCP server '${serverName}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };

    try {
      await configService.deleteMcpServer(serverName);
      logger.debug(`MCP server '${serverName}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete MCP server '${serverName}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/v0/management/mcp-servers/:serverName/status', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    logger.info(`MCP local status requested for '${serverName}'`);
    const servers = await configService.getRepository().getAllMcpServers();
    const server = servers[serverName];
    if (!server) return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
    return reply.send(mcpProcessManager.getStatus(serverName, server));
  });

  fastify.post('/v0/management/mcp-servers/:serverName/start', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    logger.info(`MCP local start requested for '${serverName}'`);
    const servers = await configService.getRepository().getAllMcpServers();
    const server = servers[serverName];
    if (!server) return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
    if (server.mode !== 'local_http')
      return reply.code(400).send({ error: 'MCP server is not local_http' });
    return reply.send(await mcpProcessManager.start(serverName, server));
  });

  fastify.post('/v0/management/mcp-servers/:serverName/stop', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    logger.info(`MCP local stop requested for '${serverName}'`);
    return reply.send(await mcpProcessManager.stop(serverName));
  });

  fastify.post('/v0/management/mcp-servers/:serverName/restart', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    logger.info(`MCP local restart requested for '${serverName}'`);
    const servers = await configService.getRepository().getAllMcpServers();
    const server = servers[serverName];
    if (!server) return reply.code(404).send({ error: `MCP server '${serverName}' not found` });
    if (server.mode !== 'local_http')
      return reply.code(400).send({ error: 'MCP server is not local_http' });
    return reply.send(await mcpProcessManager.restart(serverName, server));
  });

  fastify.get('/v0/management/mcp-servers/:serverName/process-logs', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };
    logger.info(`MCP local process logs requested for '${serverName}'`);
    return reply.send({ data: mcpProcessManager.getLogs(serverName) });
  });

  // ─── MCP Server Enabled ──────────────────────────────────────────

  fastify.get('/v0/management/config/mcp-enabled', async (_request, reply) => {
    try {
      const enabled = await configService.getSetting<boolean>('mcpEnabled', true);
      return reply.send({ enabled });
    } catch (e: any) {
      logger.error('Failed to read mcp-enabled setting', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.patch('/v0/management/config/mcp-enabled', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'Object body is required' });
    }
    if (typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be a boolean' });
    }

    try {
      await configService.setSetting('mcpEnabled', body.enabled);
      logger.debug(`MCP server ${body.enabled ? 'enabled' : 'disabled'} via API`);
      return reply.send({ enabled: body.enabled });
    } catch (e: any) {
      logger.error('Failed to update mcp-enabled setting', e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Quota Checker Types ──────────────────────────────────────────

  fastify.get('/v0/management/quota-checker-types', async (_request, reply) => {
    const defs = getCheckerDefinitions();
    return reply.send({
      types: defs.map((d) => ({ type: d.type, displayName: d.displayName })),
      count: defs.length,
    });
  });
}
