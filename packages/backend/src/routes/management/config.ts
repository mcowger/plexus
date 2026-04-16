import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import {
  VALID_QUOTA_CHECKER_TYPES,
  ProviderConfigSchema,
  ModelConfigSchema,
  KeyConfigSchema,
  McpServerConfigSchema,
} from '../../config';
import { ConfigService } from '../../services/config-service';
import { UsageStorageService } from '../../services/usage-storage';
import type { GpuParams, ModelArchitecture } from '@plexus/shared';
import { DEFAULT_GPU_PARAMS } from '@plexus/shared';

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
      // Check if ADMIN_KEY was loaded from YAML (deprecated, but kept for backward compatibility)
      const adminKeyFromYaml = process.env.ADMIN_KEY_FROM_YAML === 'true';
      return reply.send({
        adminKeyFromYaml: adminKeyFromYaml,
      });
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
      return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
    }
    try {
      await configService.saveProvider(slug, result.data);
      logger.info(`Provider '${slug}' saved via API (PUT)`);
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
        return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
      }
      await configService.saveProvider(slug, result.data);
      logger.info(`Provider '${slug}' updated via API (PATCH)`);
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
      logger.info(`Provider '${providerId}' deleted via API${cascade ? ' (cascade)' : ''}`);
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

  // PUT — full create-or-replace with Zod validation
  // Using wildcard to support slugs containing '/' (e.g. "provider/model")
  fastify.put('/v0/management/aliases/*', async (request, reply) => {
    const slug = (request.params as { '*': string })['*'];
    const result = ModelConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
    }
    try {
      await configService.saveAlias(slug, result.data);

      await recalculateEnergyIfChanged(
        slug,
        result.data.model_architecture,
        usageStorage,
        buildProviderGpuParamsMap(configService)
      );

      logger.info(`Model alias '${slug}' saved via API (PUT)`);
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
        return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
      }
      await configService.saveAlias(slug, result.data);

      await recalculateEnergyIfChanged(
        slug,
        result.data.model_architecture,
        usageStorage,
        buildProviderGpuParamsMap(configService)
      );

      logger.info(`Model alias '${slug}' updated via API (PATCH)`);
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
      logger.info(`Model alias '${aliasId}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete model alias '${aliasId}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/models', async (_request, reply) => {
    try {
      const deletedCount = await configService.deleteAllAliases();
      logger.info(`Deleted all model aliases (${deletedCount}) via API`);
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

  // PUT — full create-or-replace with Zod validation
  fastify.put('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const result = KeyConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
    }
    try {
      await configService.saveKey(name, result.data);
      logger.info(`API key '${name}' saved via API (PUT)`);
      return reply.send({ success: true, name });
    } catch (e: any) {
      logger.error(`Failed to save API key '${name}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/keys/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      await configService.deleteKey(name);
      logger.info(`API key '${name}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete API key '${name}'`, e);
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

    try {
      await configService.setSettingsBulk(body);
      logger.info('System settings updated via API');
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error('Failed to update system settings', e);
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

  // ─── MCP Servers ──────────────────────────────────────────────────

  fastify.get('/v0/management/mcp-servers', async (_request, reply) => {
    try {
      const servers = await configService.getRepository().getAllMcpServers();
      return reply.send(servers);
    } catch (e: any) {
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.put('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };

    if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(serverName)) {
      return reply.code(400).send({
        error:
          'Invalid server name. Must be a slug (lowercase letters, numbers, hyphens, underscores, 2-63 characters)',
      });
    }

    const result = McpServerConfigSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Validation failed', details: result.error.errors });
    }

    try {
      await configService.saveMcpServer(serverName, result.data);
      logger.info(`MCP server '${serverName}' saved via API (PUT)`);
      return reply.send({ success: true, name: serverName });
    } catch (e: any) {
      logger.error(`Failed to save MCP server '${serverName}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.delete('/v0/management/mcp-servers/:serverName', async (request, reply) => {
    const { serverName } = request.params as { serverName: string };

    try {
      await configService.deleteMcpServer(serverName);
      logger.info(`MCP server '${serverName}' deleted via API`);
      return reply.send({ success: true });
    } catch (e: any) {
      logger.error(`Failed to delete MCP server '${serverName}'`, e);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Quota Checker Types ──────────────────────────────────────────

  fastify.get('/v0/management/quota-checker-types', async (_request, reply) => {
    return reply.send({
      types: VALID_QUOTA_CHECKER_TYPES,
      count: VALID_QUOTA_CHECKER_TYPES.length,
    });
  });

  // Support YAML and Plain Text payloads for management API
  fastify.addContentTypeParser(
    ['text/plain', 'application/x-yaml', 'text/yaml'],
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body);
    }
  );
}
