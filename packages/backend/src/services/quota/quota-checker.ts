import type {
  QuotaCheckerConfig,
  QuotaCheckResult,
  QuotaWindow,
  QuotaUnit,
  QuotaStatus,
  QuotaWindowType,
  QuotaGroup,
} from '../../types/quota';

export abstract class QuotaChecker {
  config: QuotaCheckerConfig;

  constructor(config: QuotaCheckerConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  get provider(): string {
    return this.config.provider;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get intervalMinutes(): number {
    return this.config.intervalMinutes;
  }

  abstract checkQuota(): Promise<QuotaCheckResult>;

  protected getOAuthMetadata(): { oauthAccountId?: string; oauthProvider?: string } {
    const oauthAccountId = (this.config.options.oauthAccountId as string | undefined)?.trim();
    const oauthProvider = (this.config.options.oauthProvider as string | undefined)?.trim();

    return {
      oauthAccountId: oauthAccountId && oauthAccountId.length > 0 ? oauthAccountId : undefined,
      oauthProvider: oauthProvider && oauthProvider.length > 0 ? oauthProvider : undefined,
    };
  }

  protected getOption<T>(key: string, defaultValue: T): T {
    return (this.config.options[key] as T) ?? defaultValue;
  }

  protected requireOption<T>(key: string): T {
    const value = this.config.options[key] as T | undefined;
    if (value === undefined) {
      throw new Error(
        `Required option '${key}' not provided for quota checker '${this.config.id}'`
      );
    }
    return value;
  }

  protected calculateUtilization(used: number, limit?: number, remaining?: number): number {
    if (limit !== undefined && limit > 0) {
      return (used / limit) * 100;
    }
    if (remaining !== undefined && used > 0) {
      const total = used + remaining;
      return (used / total) * 100;
    }
    return 0;
  }

  protected determineStatus(utilizationPercent: number): QuotaStatus {
    if (utilizationPercent >= 100) return 'exhausted';
    if (utilizationPercent >= 90) return 'critical';
    if (utilizationPercent >= 75) return 'warning';
    return 'ok';
  }

  protected calculateResetSeconds(resetsAt: Date): number {
    const now = Date.now();
    const resetTime = resetsAt.getTime();
    const diff = Math.max(0, Math.floor((resetTime - now) / 1000));
    return diff;
  }

  protected successResult(windows: QuotaWindow[]): QuotaCheckResult;
  protected successResult(windows: undefined, groups: QuotaGroup[]): QuotaCheckResult;
  protected successResult(windows?: QuotaWindow[], groups?: QuotaGroup[]): QuotaCheckResult {
    const oauthMetadata = this.getOAuthMetadata();
    return {
      provider: this.config.provider,
      checkerId: this.config.id,
      checkedAt: new Date(),
      success: true,
      ...oauthMetadata,
      windows,
      groups,
    };
  }

  protected errorResult(error: string | Error): QuotaCheckResult {
    const errorMessage = error instanceof Error ? error.message : error;
    const oauthMetadata = this.getOAuthMetadata();
    return {
      provider: this.config.provider,
      checkerId: this.config.id,
      checkedAt: new Date(),
      success: false,
      error: errorMessage,
      ...oauthMetadata,
    };
  }

  protected createWindow(
    windowType: QuotaWindowType,
    limit: number | undefined,
    used: number | undefined,
    remaining: number | undefined,
    unit: QuotaUnit,
    resetsAt?: Date,
    description?: string
  ): QuotaWindow {
    const utilizationPercent = this.calculateUtilization(used ?? 0, limit, remaining);
    const status = this.determineStatus(utilizationPercent);
    const resetInSeconds = resetsAt ? this.calculateResetSeconds(resetsAt) : undefined;

    return {
      windowType,
      utilizationPercent,
      unit,
      status,
      limit,
      used,
      remaining,
      resetsAt,
      resetInSeconds,
      description,
    };
  }
}
