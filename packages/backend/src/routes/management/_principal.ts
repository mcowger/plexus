import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import { getConfig } from '../../config';

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
  try {
    const config = getConfig();
    if (!config.keys) return null;
    for (const [name, cfg] of Object.entries(config.keys)) {
      if ((cfg as { secret: string }).secret === providedKey) {
        return {
          role: 'limited',
          keyName: name,
          allowedProviders: (cfg as { allowedProviders?: string[] }).allowedProviders ?? [],
          allowedModels: (cfg as { allowedModels?: string[] }).allowedModels ?? [],
          quotaName: (cfg as { quota?: string | null }).quota ?? null,
          comment: (cfg as { comment?: string | null }).comment ?? null,
        };
      }
    }
    return null;
  } catch (err) {
    logger.silly(`[AUTH] api_keys lookup failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Fastify preHandler that authenticates a request and attaches the principal.
 * 401 if the credential is missing/invalid.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const principal = await resolvePrincipal(request);
  if (!principal) {
    logger.silly(`[ADMIN AUTH] Rejected request to ${request.url} - invalid or missing credential`);
    reply.code(401).send({ error: { message: 'Unauthorized', type: 'auth_error', code: 401 } });
    return;
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
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.principal) {
    reply.code(401).send({ error: { message: 'Unauthorized', type: 'auth_error', code: 401 } });
    return;
  }
  if (request.principal.role !== 'admin') {
    reply.code(403).send({
      error: {
        message: 'Admin privileges required',
        type: 'forbidden',
        code: 403,
      },
    });
    return;
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
