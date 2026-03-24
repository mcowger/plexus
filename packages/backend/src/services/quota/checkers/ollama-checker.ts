import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

export class OllamaQuotaChecker extends QuotaChecker {
  readonly category = 'rate-limit' as const;

  private readonly baseUrl = 'https://ollama.com/settings';

  async checkQuota(): Promise<QuotaCheckResult> {
    const sessionCookie = this.requireOption<string>('sessionCookie');

    try {
      logger.debug(`[ollama] Fetching ${this.baseUrl}`);

      const response = await fetch(this.baseUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          Accept: 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: `__Secure-session=${sessionCookie}`,
        },
      });

      if (!response.ok) {
        if (response.status === 303 || response.url.includes('/signin')) {
          return this.errorResult(
            new Error('Authentication failed. The session cookie may be expired or invalid.')
          );
        }
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const html = await response.text();

      const sessionUsage = this.extractUsage(html, 'Session usage');
      const weeklyUsage = this.extractUsage(html, 'Weekly usage');

      const windows: QuotaWindow[] = [];

      if (sessionUsage) {
        windows.push(
          this.createWindow(
            'five_hour',
            100,
            sessionUsage.percent,
            100 - sessionUsage.percent,
            'percentage',
            sessionUsage.resetsAt,
            'Session usage'
          )
        );
      }

      if (weeklyUsage) {
        windows.push(
          this.createWindow(
            'weekly',
            100,
            weeklyUsage.percent,
            100 - weeklyUsage.percent,
            'percentage',
            weeklyUsage.resetsAt,
            'Weekly usage'
          )
        );
      }

      if (windows.length === 0) {
        return this.errorResult(new Error('Could not parse usage data from Ollama settings page'));
      }

      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private extractUsage(
    html: string,
    label: 'Session usage' | 'Weekly usage'
  ): { percent: number; resetsAt: Date } | null {
    const labelIndex = html.indexOf(label);
    if (labelIndex === -1) {
      logger.debug(`[ollama] Label "${label}" not found in HTML`);
      return null;
    }

    const snippet = html.slice(labelIndex, labelIndex + 1000);

    const percentMatch = snippet.match(/style="width:\s*([\d.]+)%"/);
    if (!percentMatch) {
      logger.debug(`[ollama] Could not extract usage percent for ${label}`);
      return null;
    }
    const percent = parseFloat(percentMatch[1]!);

    const resetMatch = snippet.match(/data-time="([^"]+)"/);
    const resetsAt = resetMatch ? new Date(resetMatch[1]!) : undefined;

    logger.silly(`[ollama] ${label}: ${percent}%, resets at ${resetsAt}`);

    return { percent, resetsAt: resetsAt || new Date() };
  }
}
