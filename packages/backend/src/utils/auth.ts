import { FastifyRequest } from 'fastify';
import { getConfig, isKeyDisabled } from '../config';
import { logger } from './logger';
import { getTrustedClientIp } from './ip';
import { isIpAllowed } from './ip-match';
import { enterRequestContext } from '../services/observability/request-context';
import { ConfigService } from '../services/configuration/config-service';

export function attachKeyAccessPolicy<T extends { metadata?: Record<string, any> }>(
  request: FastifyRequest,
  unifiedRequest: T
): T {
  const keyConfig = (request as any).keyConfig as
    | {
        allowedModels?: string[];
        allowedProviders?: string[];
        excludedModels?: string[];
        excludedProviders?: string[];
      }
    | undefined;

  // Canonical normalization: trim/strip empty entries.
  // Dispatcher's getKeyAccessPolicy() trusts this is already clean.
  const allowedModels = keyConfig?.allowedModels?.map((entry) => entry.trim()).filter(Boolean);
  const allowedProviders = keyConfig?.allowedProviders
    ?.map((entry) => entry.trim())
    .filter(Boolean);
  const excludedModels = keyConfig?.excludedModels?.map((entry) => entry.trim()).filter(Boolean);
  const excludedProviders = keyConfig?.excludedProviders
    ?.map((entry) => entry.trim())
    .filter(Boolean);

  if (
    (!allowedModels || allowedModels.length === 0) &&
    (!allowedProviders || allowedProviders.length === 0) &&
    (!excludedModels || excludedModels.length === 0) &&
    (!excludedProviders || excludedProviders.length === 0)
  ) {
    return unifiedRequest;
  }

  return {
    ...unifiedRequest,
    metadata: {
      ...(unifiedRequest.metadata || {}),
      plexus_metadata: {
        ...(unifiedRequest.metadata?.plexus_metadata || {}),
        plexus_key_policy: {
          ...(allowedModels && allowedModels.length > 0 ? { allowedModels } : {}),
          ...(allowedProviders && allowedProviders.length > 0 ? { allowedProviders } : {}),
          ...(excludedModels && excludedModels.length > 0 ? { excludedModels } : {}),
          ...(excludedProviders && excludedProviders.length > 0 ? { excludedProviders } : {}),
        },
      },
    },
  };
}

export function isRequestIpAllowed(
  request: FastifyRequest,
  allowedIps: string[] | undefined,
  trustedProxies: string[] | undefined
): boolean {
  const clientIp = getTrustedClientIp(request, trustedProxies);
  return isIpAllowed(clientIp, allowedIps);
}

export interface PlexusApiKeyAuthResult {
  keyName: string;
  keyConfig: unknown;
  attribution: string | null;
}

export function splitApiKeyAttribution(key: string): {
  secretPart: string;
  attributionPart: string | null;
} {
  const firstColonIndex = key.indexOf(':');
  if (firstColonIndex === -1) {
    return { secretPart: key, attributionPart: null };
  }

  const secretPart = key.substring(0, firstColonIndex);
  const rawAttribution = key.substring(firstColonIndex + 1);
  return { secretPart, attributionPart: rawAttribution.toLowerCase() || null };
}

export function validatePlexusApiKey(
  key: string,
  request: FastifyRequest
): PlexusApiKeyAuthResult | null {
  const config = getConfig();
  logger.silly(`config.keys exists: ${!!config.keys}`);

  if (!config.keys) {
    logger.silly(`No keys configured`);
    return null;
  }

  const { secretPart, attributionPart } = splitApiKeyAttribution(key);

  logger.silly(`Looking for secret: ${secretPart.substring(0, 15)}`);
  logger.silly(`Available keys config: ${JSON.stringify(config.keys)}`);

  const entry = Object.entries(config.keys).find(
    ([_, k]) => (k as { secret: string }).secret === secretPart
  );

  if (!entry) {
    logger.silly(`Auth FAILED - no matching key`);
    logger.error(`Auth FAILED - no matching key for secret: ${secretPart}`);
    logger.error(`Available keys config: ${JSON.stringify(config.keys)}`);
    return null;
  }

  const keyCfg = entry[1] as { allowedIps?: string[]; expiresAt?: number; disabledAt?: number };

  if (isKeyDisabled(keyCfg)) {
    if (keyCfg.expiresAt !== undefined && keyCfg.disabledAt === undefined) {
      void ConfigService.getInstance()
        .disableTimeBoundKey(entry[0])
        .catch((error) => logger.error(`Failed to disable expired key ${entry[0]}`, error));
    }
    logger.silly(`Auth FAILED - key disabled: ${entry[0]}`);
    return null;
  }

  if (!isRequestIpAllowed(request, keyCfg.allowedIps, config.trustedProxies)) {
    logger.silly(`Auth FAILED - client IP not in allowlist for key: ${entry[0]}`);
    return null;
  }

  return {
    keyName: entry[0],
    keyConfig: entry[1],
    attribution: attributionPart,
  };
}

export function attachPlexusApiKeyAuth(request: FastifyRequest, result: PlexusApiKeyAuthResult) {
  (request as any).keyName = result.keyName;
  (request as any).attribution = result.attribution;
  (request as any).keyConfig = result.keyConfig;
  enterRequestContext({ keyName: result.keyName });
}

export function createAuthHook(options: { allowQueryKey?: boolean } = {}) {
  const allowQueryKey = options.allowQueryKey !== false;
  return {
    onRequest: async (request: FastifyRequest) => {
      logger.silly(`onRequest called: ${request.method} ${request.url}`);

      // Normalize Authorization header - ensure it has "Bearer " prefix
      const authHeader = request.headers.authorization;
      if (authHeader) {
        if (!authHeader.toLowerCase().startsWith('bearer ')) {
          logger.silly(`Adding Bearer prefix to existing Authorization header`);
          request.headers.authorization = `Bearer ${authHeader}`;
        }
      } else {
        // No Authorization header, try x-api-key or x-goog-api-key
        let apiKey = request.headers['x-api-key'] || request.headers['x-goog-api-key'];

        if (allowQueryKey && !apiKey && request.query && typeof request.query === 'object') {
          apiKey = (request.query as any).key;
        }

        if (typeof apiKey === 'string') {
          request.headers.authorization = `Bearer ${apiKey}`;
          logger.silly(`Set authorization from x-api-key/x-goog-api-key`);
        }
      }

      logger.silly(
        `Final Authorization header: ${request.headers.authorization?.substring(0, 25)}`
      );
    },

    bearerAuthOptions: {
      keys: new Set([]),
      auth: (key: string, req: any) => {
        logger.silly(`bearerAuth auth called with key: ${key.substring(0, 25)}`);

        const result = validatePlexusApiKey(key, req as FastifyRequest);
        if (result) {
          logger.silly(`Auth SUCCESS for key: ${result.keyName}`);
          attachPlexusApiKeyAuth(req as FastifyRequest, result);
          return true;
        }
        return false;
      },
      errorResponse: ((err: Error) => {
        logger.silly(`Error response: ${err.message}`);
        return { error: { message: err.message, type: 'auth_error', code: 401 } };
      }) as any,
    },
  };
}
