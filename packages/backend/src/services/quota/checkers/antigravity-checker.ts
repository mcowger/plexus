import { defineChecker } from '../checker-registry';
import { z } from 'zod';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';
import { logger } from '../../../utils/logger';

const ANTIGRAVITY_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
] as const;

const ANTIGRAVITY_HIDDEN_MODELS = new Set(['tab_flash_lite_preview']);

const ANTIGRAVITY_STATIC_HEADERS = {
  'User-Agent': 'antigravity/1.11.5 darwin/arm64',
  'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  'Client-Metadata': JSON.stringify({
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }),
};

interface CloudCodeModelEntry {
  displayName?: string;
  model?: string;
  isInternal?: boolean;
  quotaInfo?: {
    remainingFraction?: number;
    limit?: string;
    resetTime?: string;
  };
}

interface CloudCodeQuotaResponse {
  models?: Record<string, CloudCodeModelEntry>;
}

async function resolveCredentials(
  ctx: { getOption<T>(key: string, def: T): T; checkerId: string }
): Promise<{ token: string; projectId?: string }> {
  const configuredApiKey = ctx.getOption<string>('apiKey', '').trim();
  if (configuredApiKey) {
    if (configuredApiKey.startsWith('{')) {
      try {
        const parsed = JSON.parse(configuredApiKey) as {
          token?: string; accessToken?: string; access?: string; key?: string;
          projectId?: string; project?: string;
        };
        const token = parsed.token || parsed.accessToken || parsed.access || parsed.key;
        if (token) return { token, projectId: parsed.projectId || parsed.project };
      } catch {}
    }
    return { token: configuredApiKey };
  }

  const provider = ctx.getOption<string>('oauthProvider', 'google-antigravity').trim() || 'google-antigravity';
  const oauthAccountId = ctx.getOption<string>('oauthAccountId', '').trim();
  const authManager = OAuthAuthManager.getInstance();

  logger.debug(`[antigravity-checker] resolveCredentials for '${ctx.checkerId}'`);

  let apiKeyResult: string;
  try {
    apiKeyResult = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  } catch {
    authManager.reload();
    logger.info(`[antigravity-checker] Reloaded OAuth auth file and retrying for provider '${provider}'.`);
    apiKeyResult = oauthAccountId
      ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
      : await authManager.getApiKey(provider as OAuthProvider);
  }

  const credentials = authManager.getCredentials(
    provider as OAuthProvider,
    oauthAccountId || null
  ) as Record<string, unknown> | null;

  let token: string =
    apiKeyResult ||
    (credentials?.access as string) ||
    (credentials?.accessToken as string) ||
    (credentials?.token as string) ||
    (credentials?.key as string);
  let projectId: string | undefined =
    (credentials?.projectId as string) || (credentials?.project as string);

  if (typeof token === 'string' && token.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(token) as { token?: string; accessToken?: string; access?: string; key?: string; projectId?: string; project?: string };
      const extractedToken = parsed.token || parsed.accessToken || parsed.access || parsed.key;
      if (extractedToken) {
        token = extractedToken;
        projectId = projectId || parsed.projectId || parsed.project;
      }
    } catch {}
  }

  if (!token) throw new Error(`[antigravity-checker] No token found for provider '${provider}'`);
  return { token, projectId };
}

async function fetchModels(
  endpoint: string,
  token: string,
  projectId?: string
): Promise<{ data?: CloudCodeQuotaResponse; status?: number }> {
  try {
    const url = `${endpoint}/v1internal:fetchAvailableModels`;
    const payload = projectId ? { project: projectId } : {};
    logger.debug(`[antigravity-checker] Requesting quota from ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...ANTIGRAVITY_STATIC_HEADERS,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'no error body');
      logger.warn(`[antigravity-checker] Request failed with status ${response.status}: ${errorText}`);
      return { status: response.status };
    }

    const data = (await response.json()) as CloudCodeQuotaResponse;
    return { data };
  } catch (error: unknown) {
    logger.error(`[antigravity-checker] Fetch error: ${(error as Error).message}`);
    return {};
  }
}

export default defineChecker({
  type: 'antigravity',
  optionsSchema: z.object({
    apiKey: z.string().optional(),
    oauthAccountId: z.string().optional(),
    oauthProvider: z.string().optional(),
    endpoint: z.string().url().optional(),
  }),
  async check(ctx) {
    const { token, projectId } = await resolveCredentials(ctx);

    let data: CloudCodeQuotaResponse | undefined;
    let lastStatus: number | undefined;

    const configEndpoint = ctx.getOption<string>('endpoint', '');
    const endpointList = configEndpoint
      ? [configEndpoint]
      : (ANTIGRAVITY_ENDPOINTS as unknown as string[]);

    for (const endpoint of endpointList) {
      const result = await fetchModels(endpoint, token, projectId);
      if (result.data) { data = result.data; break; }
      if (result.status) lastStatus = result.status;
    }

    if (!data) {
      throw new Error(
        lastStatus
          ? `quota request failed with status ${lastStatus}`
          : 'all antigravity endpoints failed'
      );
    }

    interface ModelQuota { name: string; remainingFraction: number; resetAt?: Date }
    const modelByName = new Map<string, ModelQuota>();

    for (const [modelId, model] of Object.entries(data.models ?? {})) {
      if (model.isInternal) continue;
      if (modelId && ANTIGRAVITY_HIDDEN_MODELS.has(modelId.toLowerCase())) continue;

      const name = model.displayName ?? modelId ?? model.model ?? 'unknown';
      if (!name || ANTIGRAVITY_HIDDEN_MODELS.has(name.toLowerCase())) continue;

      const remainingFraction = model.quotaInfo?.remainingFraction ?? 1;
      const resetAtStr = model.quotaInfo?.resetTime;
      const resetAt = resetAtStr ? new Date(resetAtStr) : undefined;
      const validResetAt = resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : undefined;

      const existing = modelByName.get(name);
      if (!existing) {
        modelByName.set(name, { name, remainingFraction, resetAt: validResetAt });
        continue;
      }

      let next = existing;
      if (remainingFraction < existing.remainingFraction) {
        next = { name, remainingFraction, resetAt: validResetAt };
      } else if (remainingFraction === existing.remainingFraction && validResetAt) {
        if (!existing.resetAt || validResetAt.getTime() < existing.resetAt.getTime()) {
          next = { ...existing, resetAt: validResetAt };
        }
      } else if (!existing.resetAt && validResetAt) {
        next = { ...existing, resetAt: validResetAt };
      }
      if (next !== existing) modelByName.set(name, next);
    }

    const parsedModels = Array.from(modelByName.values()).sort((a, b) => a.name.localeCompare(b.name));
    const meters = [];

    for (const model of parsedModels) {
      const fraction = Number.isFinite(model.remainingFraction) ? model.remainingFraction : 1;
      const used = Math.max(0, Math.min(100, (1 - fraction) * 100));
      const remaining = Math.max(0, Math.min(100, fraction * 100));
      meters.push(
        ctx.allowance({
          key: `model_${model.name.toLowerCase().replace(/\s+/g, '_')}`,
          label: model.name,
          scope: model.name,
          unit: 'percentage',
          used,
          remaining,
          periodValue: 5,
          periodUnit: 'hour',
          periodCycle: 'rolling',
          resetsAt: model.resetAt?.toISOString(),
        })
      );
    }

    logger.debug(`[antigravity-checker] Returning ${meters.length} meters`);
    return meters;
  },
});
