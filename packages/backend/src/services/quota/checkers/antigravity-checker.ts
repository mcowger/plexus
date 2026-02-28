import type { QuotaCheckResult, QuotaCheckerConfig, QuotaWindow } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai';
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
      logger.debug(
        `[antigravity-checker] Fetching models from ${endpoint}/v1internal:fetchAvailableModels`
      );
      const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...ANTIGRAVITY_HEADERS,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return { status: response.status };
      const data = (await response.json()) as CloudCodeQuotaResponse;
      return { data };
    } catch {
      return {};
    }
  }

  private async resolveCredentials(): Promise<{ token: string; projectId?: string }> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      // Support JSON-encoded { token, projectId } from pi-ai style api key
      if (configuredApiKey.startsWith('{')) {
        try {
          const parsed = JSON.parse(configuredApiKey) as { token?: string; projectId?: string };
          if (parsed.token) {
            return { token: parsed.token, projectId: parsed.projectId };
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
    );
    const projectId = (credentials as unknown as Record<string, unknown>)?.projectId as
      | string
      | undefined;

    return { token: apiKeyResult, projectId };
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
