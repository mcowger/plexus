import type {
  QuotaCheckResult,
  QuotaCheckerConfig,
  QuotaWindow,
  QuotaWindowType,
} from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { OAuthAuthManager } from '../../oauth-auth-manager';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';
import { logger } from '../../../utils/logger';

interface GeminiBucket {
  name?: string;
  limit?: string;
  remaining?: string;
  resetAt?: string | number;
  remainingFraction?: number;
  description?: string;
}

interface GeminiQuotaResponse {
  buckets?: GeminiBucket[];
  quota?: {
    buckets?: GeminiBucket[];
  };
  userQuota?: {
    buckets?: GeminiBucket[];
  };
}

export class GeminiCliQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;
  private endpoint: string;
  private userAgent: string;
  private googApiClient: string;
  private clientMetadata: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>(
      'endpoint',
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
    );
    this.userAgent = this.getOption<string>('userAgent', 'google-api-nodejs-client/10.3.0');
    this.googApiClient = this.getOption<string>('googApiClient', 'gl-node/22.18.0');
    this.clientMetadata = this.getOption<string>(
      'clientMetadata',
      'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI'
    );
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const apiKey = await this.resolveApiKey();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey.slice(0, 10)}...${apiKey.slice(-5)}`,
        'Content-Type': 'application/json',
      };

      logger.info(
        `[gemini-cli-checker] Requesting quota from ${this.endpoint} with headers: ${JSON.stringify(headers)}`
      );

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      const bodyText = await response.text();
      if (!response.ok) {
        return this.errorResult(
          new Error(`quota request failed with status ${response.status}: ${bodyText}`)
        );
      }

      let data: GeminiQuotaResponse;
      try {
        data = JSON.parse(bodyText) as GeminiQuotaResponse;
      } catch (error) {
        return this.errorResult(
          new Error(`failed to parse gemini quota response: ${String(error)}`)
        );
      }

      const buckets = this.extractBuckets(data);
      if (!buckets || buckets.length === 0) {
        logger.debug(`[gemini-cli-checker] No buckets found in response: ${bodyText}`);
        return this.successResult([]);
      }

      const windows = this.buildWindows(buckets);
      return {
        ...this.successResult(windows),
        rawResponse: data,
      };
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private async resolveApiKey(): Promise<string> {
    const configuredApiKey = this.getOption<string>('apiKey', '').trim();
    if (configuredApiKey) {
      return configuredApiKey;
    }

    const provider =
      this.getOption<string>('oauthProvider', 'google-gemini-cli').trim() || 'google-gemini-cli';
    const oauthAccountId = this.getOption<string>('oauthAccountId', '').trim();
    const authManager = OAuthAuthManager.getInstance();

    const rawCreds = oauthAccountId
      ? authManager.getCredentials(provider as OAuthProvider, oauthAccountId)
      : authManager.getCredentials(provider as OAuthProvider);
    logger.debug(
      `[gemini-cli-checker] resolveApiKey for '${this.id}' — ` +
        `refresh=${rawCreds?.refresh ? `present(${rawCreds.refresh.length} chars)` : 'MISSING'}, ` +
        `access=${rawCreds?.access ? `present(${rawCreds.access.length} chars)` : 'MISSING'}, ` +
        `expires=${rawCreds?.expires} (${rawCreds && rawCreds.expires > Date.now() ? 'valid' : 'EXPIRED or missing'})`
    );

    let apiKeyResult: any;
    try {
      apiKeyResult = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    } catch (error) {
      authManager.reload();
      logger.info(
        `[gemini-cli-checker] Reloaded OAuth auth file and retrying token retrieval for provider '${provider}'.`
      );
      apiKeyResult = oauthAccountId
        ? await authManager.getApiKey(provider as OAuthProvider, oauthAccountId)
        : await authManager.getApiKey(provider as OAuthProvider);
    }

    // Handle both string and object responses from getApiKey
    if (typeof apiKeyResult === 'object' && apiKeyResult !== null && 'token' in apiKeyResult) {
      return apiKeyResult.token;
    }

    if (typeof apiKeyResult === 'string' && apiKeyResult.startsWith('{')) {
      try {
        const parsed = JSON.parse(apiKeyResult);
        if (parsed.token) return parsed.token;
      } catch (e) {
        // Not JSON, return as is
      }
    }

    return apiKeyResult;
  }

  private extractBuckets(data: GeminiQuotaResponse): GeminiBucket[] {
    if (Array.isArray(data.buckets)) return data.buckets;
    if (data.quota && Array.isArray(data.quota.buckets)) return data.quota.buckets;
    if (data.userQuota && Array.isArray(data.userQuota.buckets)) return data.userQuota.buckets;
    return [];
  }

  private buildWindows(buckets: GeminiBucket[]): QuotaWindow[] {
    // Aggregate quotas by model type to match reference implementation
    const quotas: Record<string, number> = {};
    for (const bucket of buckets) {
      const model = bucket.name || bucket.description || 'unknown';
      const frac = bucket.remainingFraction ?? 1;
      if (!quotas[model] || frac < quotas[model]) {
        quotas[model] = frac;
      }
    }

    const windows: QuotaWindow[] = [];
    let proMin = 1;
    let flashMin = 1;
    let hasProModel = false;
    let hasFlashModel = false;

    for (const [model, frac] of Object.entries(quotas)) {
      if (model.toLowerCase().includes('pro')) {
        hasProModel = true;
        if (frac < proMin) proMin = frac;
      }
      if (model.toLowerCase().includes('flash')) {
        hasFlashModel = true;
        if (frac < flashMin) flashMin = frac;
      }
    }

    if (hasProModel) {
      windows.push(
        this.createWindow(
          'five_hour',
          100,
          (1 - proMin) * 100,
          proMin * 100,
          'percentage',
          undefined,
          'Pro Plan Quota'
        )
      );
    }
    if (hasFlashModel) {
      windows.push(
        this.createWindow(
          'five_hour',
          100,
          (1 - flashMin) * 100,
          flashMin * 100,
          'percentage',
          undefined,
          'Flash Plan Quota'
        )
      );
    }

    // If no Pro/Flash models were matched but we have buckets, fall back to individual buckets
    if (windows.length === 0 && buckets.length > 0) {
      return buckets.map((bucket, index) => {
        const remainingFraction = bucket.remainingFraction ?? 1.0;
        const usedPercent = (1.0 - remainingFraction) * 100;
        const remainingPercent = remainingFraction * 100;

        return this.createWindow(
          'five_hour',
          100,
          usedPercent,
          remainingPercent,
          'percentage',
          undefined,
          bucket.description || bucket.name || `Gemini Quota ${index + 1}`
        );
      });
    }

    return windows;
  }
}
