import { FastifyRequest } from 'fastify';
import { getConfig } from '../config';
import { logger } from './logger';
import { enterRequestContext } from '../services/request-context';

export function attachKeyAccessPolicy<T extends { metadata?: Record<string, any> }>(
  request: FastifyRequest,
  unifiedRequest: T
): T {
  const keyConfig = (request as any).keyConfig as
    | {
        allowedModels?: string[];
        allowedProviders?: string[];
      }
    | undefined;

  // Canonical normalization: trim/strip empty entries.
  // Dispatcher's getKeyAccessPolicy() trusts this is already clean.
  const allowedModels = keyConfig?.allowedModels?.map((entry) => entry.trim()).filter(Boolean);
  const allowedProviders = keyConfig?.allowedProviders
    ?.map((entry) => entry.trim())
    .filter(Boolean);

  if (
    (!allowedModels || allowedModels.length === 0) &&
    (!allowedProviders || allowedProviders.length === 0)
  ) {
    return unifiedRequest;
  }

  return {
    ...unifiedRequest,
    metadata: {
      ...(unifiedRequest.metadata || {}),
      plexus_key_policy: {
        ...(allowedModels && allowedModels.length > 0 ? { allowedModels } : {}),
        ...(allowedProviders && allowedProviders.length > 0 ? { allowedProviders } : {}),
      },
    },
  };
}

export function createAuthHook() {
  return {
    onRequest: async (request: FastifyRequest) => {
      logger.silly(`[AUTH] onRequest called: ${request.method} ${request.url}`);

      // Normalize Authorization header - ensure it has "Bearer " prefix
      const authHeader = request.headers.authorization;
      if (authHeader) {
        if (!authHeader.toLowerCase().startsWith('bearer ')) {
          logger.silly(`[AUTH] Adding Bearer prefix to existing Authorization header`);
          request.headers.authorization = `Bearer ${authHeader}`;
        }
      } else {
        // No Authorization header, try x-api-key or x-goog-api-key
        let apiKey = request.headers['x-api-key'] || request.headers['x-goog-api-key'];

        if (!apiKey && request.query && typeof request.query === 'object') {
          apiKey = (request.query as any).key;
        }

        if (typeof apiKey === 'string') {
          request.headers.authorization = `Bearer ${apiKey}`;
          logger.silly(`[AUTH] Set authorization from x-api-key/x-goog-api-key`);
        }
      }

      logger.silly(
        `[AUTH] Final Authorization header: ${request.headers.authorization?.substring(0, 25)}`
      );
    },

    bearerAuthOptions: {
      keys: new Set([]),
      auth: (key: string, req: any) => {
        logger.silly(`[AUTH] bearerAuth auth called with key: ${key.substring(0, 25)}`);

        const config = getConfig();
        logger.silly(`[AUTH] config.keys exists: ${!!config.keys}`);

        if (!config.keys) {
          logger.silly(`[AUTH] No keys configured`);
          return false;
        }

        let secretPart: string;
        let attributionPart: string | null = null;

        const firstColonIndex = key.indexOf(':');
        if (firstColonIndex !== -1) {
          secretPart = key.substring(0, firstColonIndex);
          const rawAttribution = key.substring(firstColonIndex + 1);
          attributionPart = rawAttribution.toLowerCase() || null;
        } else {
          secretPart = key;
        }

        logger.silly(`[AUTH] Looking for secret: ${secretPart.substring(0, 15)}`);
        logger.silly(`[AUTH] Available keys config: ${JSON.stringify(config.keys)}`);

        const entry = Object.entries(config.keys).find(
          ([_, k]) => (k as { secret: string }).secret === secretPart
        );

        if (entry) {
          logger.silly(`[AUTH] Auth SUCCESS for key: ${entry[0]}`);
          req.keyName = entry[0];
          req.attribution = attributionPart;
          req.keyConfig = entry[1];
          // Seed the async-local request context so downstream code (notably
          // DebugManager) can resolve the key name without explicit plumbing.
          enterRequestContext({ keyName: entry[0] });
          return true;
        }

        logger.silly(`[AUTH] Auth FAILED - no matching key`);
        logger.error(`[AUTH] Auth FAILED - no matching key for secret: ${secretPart}`);
        logger.error(`[AUTH] Available keys config: ${JSON.stringify(config.keys)}`);
        return false;
      },
      errorResponse: ((err: Error) => {
        logger.silly(`[AUTH] Error response: ${err.message}`);
        return { error: { message: err.message, type: 'auth_error', code: 401 } };
      }) as any,
    },
  };
}
