import type { QuotaCheckResult, QuotaCheckerConfig, QuotaWindow } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';
import { logger } from '../../../utils/logger';

const ANTIGRAVITY_ENDPOINTS = [
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
] as const;

const ANTIGRAVITY_HIDDEN_MODELS = new Set(['tab_flash_lite_preview']);

const ANTIGRAVITY_HEADERS = {
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

interface ParsedModelQuota {
  name: string;
  remainingFraction: number;
  resetAt?: Date;
}

export class AntigravityQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  constructor(config: QuotaCheckerConfig) {
    super(config);
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const { token, projectId } = await this.resolveCredentials();

      let data: CloudCodeQuotaResponse | undefined;
      let lastStatus: number | undefined;

      const endpoints = this.getOption<string>('endpoint', '');
      const endpointList = endpoints ? [endpoints] : (ANTIGRAVITY_ENDPOINTS as unknown as string[]);

      for (const endpoint of endpointList) {
        const result = await this.fetchModels(endpoint, token, projectId);
        if (result.data) {
          data = result.data;
          break;
        }
        if (result.status) {
          lastStatus = result.status;
        }
      }

      if (!data) {
        return this.errorResult(
          new Error(
            lastStatus
              ? `quota request failed with status ${lastStatus}`
              : 'all antigravity endpoints failed'
          )
        );
      }

      const windows = this.buildWindows(data);
      return { ...this.successResult(windows), rawResponse: data };
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private async fetchModels(
    endpoint: string,
    token: string,
    projectId?: string
  ): Promise<{ data?: CloudCodeQuotaResponse; status?: number }> {
    try {
      const payload = projectId ? { project: projectId } : {};
      const url = `${endpoint}/v1internal:fetchAvailableModels`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...ANTIGRAVITY_HEADERS,
      };

      const redactedToken =
        token.length > 10
          ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}`
          : '***';

      logger.debug(`[antigravity-checker] Requesting quota from ${url}`);
      logger.silly(
        `[antigravity-checker] Headers: ${JSON.stringify({
          ...headers,
          Authorization: `Bearer ${redactedToken}`,
        })}`
      );
      logger.silly(`[antigravity-checker] Payload: ${JSON.stringify(payload)}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'no error body');
        logger.warn(
          `[antigravity-checker] Request failed with status ${response.status}: ${errorText}`
        );
        return { status: response.status };
      }

      const data = (await response.json()) as CloudCodeQuotaResponse;
      logger.silly(`[antigravity-checker] Response: ${JSON.stringify(data).substring(0, 1000)}...`);
      return { data };
    } catch (error: any) {
      logger.error(`[antigravity-checker] Fetch error: ${error.message}`);
      return {};
    }
  }

  private async resolveCredentials(): Promise<{ token: string; projectId?: string }> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      // Support JSON-encoded { token, projectId } from pi-ai style api key
      if (configuredApiKey.startsWith('{')) {
        try {
          const parsed = JSON.parse(configuredApiKey) as {
            token?: string;
            accessToken?: string;
            access?: string;
            key?: string;
            projectId?: string;
            project?: string;
          };
          const token = parsed.token || parsed.accessToken || parsed.access || parsed.key;
          if (token) {
            return { token, projectId: parsed.projectId || parsed.project };
          }
        } catch {
          // not JSON
        }
      }
      return { token: configuredApiKey };
    }

    const provider =
      this.getOption<string>('oauthProvider', 'google-antigravity').trim() || 'google-antigravity';
    const oauthAccountId = this.getOption<string>('oauthAccountId', '').trim();
    const authManager = OAuthAuthManager.getInstance();

    const rawCreds = oauthAccountId
      ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
      : authManager.getCredentials(provider as OAuthProvider);
    logger.debug(
      `[antigravity-checker] resolveApiKey for '${this.id}' — ` +
        `refresh=${rawCreds?.refresh ? `present(${rawCreds.refresh.length} chars)` : 'MISSING'}, ` +
        `access=${rawCreds?.access ? `present(${rawCreds.access.length} chars)` : 'MISSING'}, ` +
        `expires=${rawCreds?.expires} (${rawCreds && rawCreds.expires > Date.now() ? 'valid' : 'EXPIRED or missing'})`
    );

    let apiKeyResult: string;
    try {
      apiKeyResult = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch (error) {
      authManager.reload();
      logger.info(
        `[antigravity-checker] Reloaded OAuth auth file and retrying token retrieval for provider '${provider}'.`
      );
      apiKeyResult = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    }

    // getApiKey returns a string token; also grab projectId from stored credentials
    const credentials = authManager.getCredentials(
      provider as OAuthProvider,
      oauthAccountId || null
    ) as any;

    let token =
      apiKeyResult ||
      credentials?.access ||
      credentials?.accessToken ||
      credentials?.token ||
      credentials?.key;
    let projectId = credentials?.projectId || credentials?.project;

    // If the token itself is a JSON string (common for pi-ai providers that bundle project info), parse it
    if (typeof token === 'string' && token.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(token);
        const extractedToken = parsed.token || parsed.accessToken || parsed.access || parsed.key;
        if (extractedToken) {
          token = extractedToken;
          projectId = projectId || parsed.projectId || parsed.project;
        }
      } catch (e) {
        logger.silly(`[antigravity-checker] Failed to parse token as JSON: ${e}`);
      }
    }

    if (!token) {
      throw new Error(`[antigravity-checker] No token found for provider '${provider}'`);
    }

    return { token, projectId };
  }

  private parseResetTime(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private buildWindows(data: CloudCodeQuotaResponse): QuotaWindow[] {
    const modelByName = new Map<string, ParsedModelQuota>();

    for (const [modelId, model] of Object.entries(data.models ?? {})) {
      if (model.isInternal) continue;
      if (modelId && ANTIGRAVITY_HIDDEN_MODELS.has(modelId.toLowerCase())) continue;

      const name = model.displayName ?? modelId ?? model.model ?? 'unknown';
      if (!name) continue;
      if (ANTIGRAVITY_HIDDEN_MODELS.has(name.toLowerCase())) continue;

      const remainingFraction = model.quotaInfo?.remainingFraction ?? 1;
      const resetAt = this.parseResetTime(model.quotaInfo?.resetTime);
      const existing = modelByName.get(name);

      if (!existing) {
        modelByName.set(name, { name, remainingFraction, resetAt });
        continue;
      }

      // Keep worst (lowest) remaining fraction; prefer earliest resetAt on ties
      let next = existing;
      if (remainingFraction < existing.remainingFraction) {
        next = { name, remainingFraction, resetAt };
      } else if (remainingFraction === existing.remainingFraction && resetAt) {
        if (!existing.resetAt || resetAt.getTime() < existing.resetAt.getTime()) {
          next = { ...existing, resetAt };
        }
      } else if (!existing.resetAt && resetAt) {
        next = { ...existing, resetAt };
      }
      if (next !== existing) modelByName.set(name, next);
    }

    const parsedModels = Array.from(modelByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return parsedModels.map((model) => {
      const fraction = Number.isFinite(model.remainingFraction) ? model.remainingFraction : 1;
      const usedPercent = Math.max(0, Math.min(100, (1 - fraction) * 100));
      const remainingPercent = Math.max(0, Math.min(100, fraction * 100));
      return this.createWindow(
        'five_hour',
        100,
        usedPercent,
        remainingPercent,
        'percentage',
        model.resetAt,
        model.name
      );
    });
  }
}
