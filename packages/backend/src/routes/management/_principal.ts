import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import { getConfig, isKeyDisabled } from '../../config';
import { isRequestIpAllowed } from '../../utils/auth';

/**
 * Sentinel error thrown by authenticate/requireAdmin so that Fastify's error
 * handler can send the correctly-shaped management auth response. In Fastify v5
 * async hooks must throw (not call reply.send) to abort the hook chain.
 */
export class ManagementAuthError extends Error {
  statusCode: number;
  authBody: object;
  constructor(statusCode: number, message: string, type: string) {
    super(message);
    this.statusCode = statusCode;
    this.authBody = { error: { message, type, code: statusCode } };
  }
}

/**
 * Authenticated identity for a management-API request.
 *
 * - admin   → full access (the ADMIN_KEY was presented)
 * - limited → a specific api_keys row; access is scoped to that key's name
 */
export type Principal =
  | { role: 'admin' }
  | {
      role: 'limited';
      keyName: string;
      allowedProviders: string[];
      allowedModels: string[];
      excludedProviders: string[];
      excludedModels: string[];
      quotaNames: string[];
      // Deprecated: first entry of quotaNames, kept for transition compat.
      quotaName?: string | null;
      comment?: string | null;
    };

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Constant-time string compare via SHA-256. Hashing normalizes input length
 * (so no length leak from `timingSafeEqual`) and keeps the per-comparison
 * cost independent of where the mismatch first occurs. Cost is one extra
 * hash per stored key per login — acceptable for a small keys set.
 */
function constantTimeHashEquals(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * Resolve the principal for an incoming management request.
 * Returns null if no valid credential was presented.
 */
export async function resolvePrincipal(request: FastifyRequest): Promise<Principal | null> {
  const providedKey = request.headers['x-admin-key'];
  if (typeof providedKey !== 'string' || providedKey.length === 0) return null;

  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && constantTimeEquals(providedKey, adminKey)) {
    return { role: 'admin' };
  }

  // Not the ADMIN_KEY — try matching an api_keys row by secret. We use the
  // in-memory config (same source v1 inference uses) rather than a direct DB
  // query so that test harnesses using setConfigForTesting(...) work and we
  // avoid a DB round-trip on every management request.
  //
  // Walk the whole list even after a match so the rejection path doesn't
  // leak a count-of-keys-before-match timing signal.
  try {
    const config = getConfig();
    if (!config.keys) return null;
    let matched: { name: string; cfg: unknown } | null = null;
    for (const [name, cfg] of Object.entries(config.keys)) {
      const storedSecret = (cfg as { secret: string }).secret;
      if (typeof storedSecret === 'string' && constantTimeHashEquals(storedSecret, providedKey)) {
        if (!matched) matched = { name, cfg };
      }
    }
    if (!matched) return null;
    const cfg = matched.cfg as {
      allowedProviders?: string[];
      allowedModels?: string[];
      excludedProviders?: string[];
      excludedModels?: string[];
      quotas?: string[];
      comment?: string | null;
      allowedIps?: string[];
      expiresAt?: number;
      disabledAt?: number;
    };
    if (isKeyDisabled(cfg)) {
      logger.silly(`Rejected disabled limited key ${matched.name}`);
      return null;
    }
    // Enforce the key's IP allowlist for the management API too, so a wrong-IP
    // key can neither call inference nor administer.
    if (!isRequestIpAllowed(request, cfg.allowedIps, config.trustedProxies)) {
      logger.silly(`Rejected limited key ${matched.name} - client IP not in allowlist`);
      return null;
    }
    return {
      role: 'limited',
      keyName: matched.name,
      allowedProviders: cfg.allowedProviders ?? [],
      allowedModels: cfg.allowedModels ?? [],
      excludedProviders: cfg.excludedProviders ?? [],
      excludedModels: cfg.excludedModels ?? [],
      quotaNames: cfg.quotas ?? [],
      quotaName: cfg.quotas?.[0] ?? null,
      comment: cfg.comment ?? null,
    };
  } catch (err) {
    logger.silly(`api_keys lookup failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fastify preHandler that authenticates a request and attaches the principal.
 * 401 if the credential is missing/invalid.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (!principal) {
    logger.silly(`Rejected request to ${request.url} - invalid or missing credential`);
    throw new ManagementAuthError(401, 'Unauthorized', 'auth_error');
  }
  request.principal = principal;
  logger.silly(
    `[ADMIN AUTH] Accepted request to ${request.url} as ${
      principal.role === 'admin' ? 'admin' : `limited(${principal.keyName})`
    }`
  );
}

/**
 * Fastify preHandler that requires the authenticated principal to be admin.
 * Must run AFTER `authenticate`. Returns 403 for limited users.
 */
export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.principal) {
    throw new ManagementAuthError(401, 'Unauthorized', 'auth_error');
  }
  if (request.principal.role !== 'admin') {
    throw new ManagementAuthError(403, 'Admin privileges required', 'forbidden');
  }
}

/**
 * For a handler that serves both admin and limited users, returns the key
 * name the principal is scoped to (or null if admin and unscoped).
 */
export function scopedKeyName(request: FastifyRequest): string | null {
  const p = request.principal;
  if (!p) return null;
  if (p.role === 'limited') return p.keyName;
  return null;
}

/**
 * True when the request is authenticated as a limited (api-key) user.
 */
export function isLimited(request: FastifyRequest): boolean {
  return request.principal?.role === 'limited';
}
