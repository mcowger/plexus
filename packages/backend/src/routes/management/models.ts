import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import {
  ModelMetadataManager,
  resolveAutomaticModelIdentity,
  resolveModelMetadata,
  resolvePreferredApi,
} from '../../services/models/model-metadata-manager';
import { getConfig, ModelConfigSchema } from '../../config';
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import {
  getCatalogAllModels,
  getCatalogModel,
  getCatalogModels,
  getModelCatalog,
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
} from '../../services/pi-ai/catalog';
import { CodexVersionService } from '../../services/oauth/codex-version-service';
import { ClaudeCodeVersionService } from '../../services/oauth/claude-code-version-service';
import { resolvePiAiProvider } from '../../services/pi-ai/provider-endpoint-match';

export async function registerModelRoutes(fastify: FastifyInstance) {
  fastify.post('/v0/management/models/metadata/refresh', async (_request, reply) => {
    const result = await ModelMetadataManager.getInstance().refreshAll(undefined, 'manual');
    return reply.send(result);
  });

  fastify.post('/v0/management/models/metadata/resolve', async (request, reply) => {
    const body = request.body as { alias_id?: unknown; model?: unknown } | null;
    if (!body || typeof body.alias_id !== 'string') {
      return reply.code(400).send({ error: 'alias_id is required' });
    }

    const parsed = ModelConfigSchema.safeParse(body.model);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const providers = getConfig().providers;
    const identity = resolveAutomaticModelIdentity(body.alias_id, parsed.data, providers);
    const resolved = resolveModelMetadata(
      body.alias_id,
      parsed.data,
      providers,
      ModelMetadataManager.getInstance()
    );
    let piModel: { provider: string; model_id: string; name: string } | null = null;
    if (identity.provider) {
      const match = getCatalogModel(identity.provider, identity.model);
      if (match) {
        piModel = { provider: identity.provider, model_id: identity.model, name: match.name };
      }
    }

    return reply.send({
      canonical_model: identity,
      pi_model: piModel,
      metadata: resolved
        ? {
            source: resolved.source,
            source_path: resolved.sourcePath,
            name: resolved.metadata.name,
          }
        : null,
      preferred_api: resolvePreferredApi(body.alias_id, parsed.data, providers) ?? null,
    });
  });

  /**
   * GET /v0/management/pi/providers
   * Returns the list of provider IDs known to the pi-ai library.
   */
  fastify.get('/v0/management/pi/providers', async (_request, reply) => {
    return reply.send({ data: getBuiltinProviders().sort() });
  });

  /**
   * GET /v0/management/pi/models
   * Returns models for a given pi provider, optionally filtered by a search query.
   *
   * Query parameters:
   *   - provider (required): pi provider id (e.g. "openai", "anthropic")
   *   - q (optional): substring filter on id or name
   */
  fastify.get('/v0/management/pi/models', async (request, reply) => {
    const query = request.query as { provider?: string; q?: string };
    if (!query.provider) {
      return reply.status(400).send({ error: `Missing 'provider' parameter` });
    }

    // Catalog models for this provider (built-in baseline + pi.dev overlay).
    const merged = getCatalogModels(query.provider).map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api as string,
      custom: false,
    }));

    const q = (query.q ?? '').toLowerCase();
    const filtered = q
      ? merged.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : merged;
    return reply.send({ data: filtered });
  });

  /**
   * POST /v0/management/pi/resolve-provider
   * Resolves the pi-ai provider id matching a new provider config: an
   * `oauthProvider` singularly identifies its pi-ai provider, otherwise the
   * `urls` are matched against pi-ai builtin base URLs (exact, then longest
   * prefix). Returns `{ provider: string | null }` — null when nothing
   * matches. The UI uses this to pre-select `pi_ai_provider` + `auto_compat`
   * for new providers and to back the pi-ai dropdown's `- auto -` entry.
   */
  fastify.post('/v0/management/pi/resolve-provider', async (request, reply) => {
    const parsed = z
      .object({
        urls: z.array(z.string()).optional(),
        oauthProvider: z.string().optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const provider = resolvePiAiProvider({
      urls: parsed.data.urls,
      oauthProvider: parsed.data.oauthProvider,
    });
    return reply.send({ data: { provider } });
  });

  /**
   * GET /v0/management/catalog/status
   * Returns the refresh cadence and current state of every interval-fetched
   * resource: model metadata catalogs (OpenRouter / models.dev / Catwalk),
   * the pi.dev model catalog overlay, and the Codex / Claude Code CLI
   * versions. Backs the System Settings refresh UI.
   */
  fastify.get('/v0/management/catalog/status', async (_request, reply) => {
    const manager = ModelMetadataManager.getInstance();
    const sourceStatus = (id: 'openrouter' | 'models.dev' | 'catwalk') => ({
      initialized: manager.isInitialized(id),
      count: manager.getAllIds(id).length,
    });
    return reply.send({
      intervals: {
        metadataMinutes: manager.getAutoRefreshIntervalMinutes(),
        piCatalogMs: REMOTE_CATALOG_REFRESH_INTERVAL_MS,
        // Codex and Claude Code versions share the same cadence as the
        // metadata manager (all wired with 60 minutes in index.ts).
        versionMinutes: CodexVersionService.getInstance().getAutoRefreshIntervalMinutes(),
      },
      versions: {
        codex: CodexVersionService.getInstance().getVersion(),
        claudeCode: ClaudeCodeVersionService.getInstance().getVersion(),
      },
      metadata: {
        openrouter: sourceStatus('openrouter'),
        modelsDev: sourceStatus('models.dev'),
        catwalk: sourceStatus('catwalk'),
      },
      piCatalog: { modelCount: getCatalogAllModels().length },
    });
  });

  /**
   * POST /v0/management/catalog/refresh-all
   * Forces an immediate reload of every interval-fetched resource, bypassing
   * throttle checks: model metadata (OpenRouter / models.dev / Catwalk),
   * the pi.dev catalog overlay (forced), and the Codex / Claude Code CLI
   * versions. Per-source failures are reported, never thrown.
   */
  fastify.post('/v0/management/catalog/refresh-all', async (_request, reply) => {
    const startedAt = Date.now();
    const refreshedAt = new Date(startedAt).toISOString();
    const codexService = CodexVersionService.getInstance();
    const claudeCodeService = ClaudeCodeVersionService.getInstance();
    const codexPrevious = codexService.getVersion();
    const claudeCodePrevious = claudeCodeService.getVersion();
    // Honor the same opt-out as startup: PLEXUS_MODEL_CATALOG_REFRESH=false
    // disables pi.dev network refresh (the persisted overlay still loads).
    const allowCatalogNetwork = process.env.PLEXUS_MODEL_CATALOG_REFRESH !== 'false';

    const [metadata, piCatalog] = await Promise.all([
      ModelMetadataManager.getInstance().refreshAll(undefined, 'manual'),
      getModelCatalog().refresh({ force: true, allowNetwork: allowCatalogNetwork }),
    ]);
    // Version fetches keep the last-known version on failure and return the
    // error string — run after the catalog work so a slow registry can't
    // delay it.
    const [codexError, claudeCodeError] = await Promise.all([
      codexService.fetchVersion(),
      claudeCodeService.fetchVersion(),
    ]);

    const durationMs = Date.now() - startedAt;
    const piCatalogErrorCount = Object.keys(piCatalog.errors).length;
    const hadErrors =
      metadata.hadErrors ||
      piCatalogErrorCount > 0 ||
      codexError !== undefined ||
      claudeCodeError !== undefined;
    if (hadErrors) {
      logger.warn('Catalog refresh-all (manual) completed with errors', {
        piCatalogErrors: piCatalog.errors,
        ...(codexError ? { codexError } : {}),
        ...(claudeCodeError ? { claudeCodeError } : {}),
      });
    } else {
      logger.info(`Catalog refresh-all (manual) completed in ${durationMs}ms`);
    }
    return reply.send({
      success: !hadErrors,
      message: hadErrors
        ? 'Catalog refresh completed with errors'
        : 'All catalogs refreshed successfully',
      trigger: 'manual',
      refreshedAt,
      durationMs,
      hadErrors,
      metadata,
      piCatalog,
      versions: {
        codex: {
          previous: codexPrevious,
          current: codexService.getVersion(),
          ...(codexError ? { error: codexError } : {}),
        },
        claudeCode: {
          previous: claudeCodePrevious,
          current: claudeCodeService.getVersion(),
          ...(claudeCodeError ? { error: claudeCodeError } : {}),
        },
      },
    });
  });
}
