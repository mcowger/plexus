import { logger } from '../../utils/logger';
import { CC_VERSION } from '../../transformers/oauth/masking/cc-constants';

// Lightweight dist-tags document (~50 bytes) — avoids downloading the full
// packument on every refresh.
const NPM_DIST_TAGS_URL =
  'https://registry.npmjs.org/-/package/@anthropic-ai%2Fclaude-code/dist-tags';

interface NpmDistTags {
  latest?: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

export class ClaudeCodeVersionService {
  private static instance: ClaudeCodeVersionService;
  private version: string;
  private autoRefreshIntervalMinutes = 60;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Startup/offline fallback so requests are fingerprinted correctly
    // before the first registry refresh completes.
    this.version = CC_VERSION;
  }

  static getInstance(): ClaudeCodeVersionService {
    if (!ClaudeCodeVersionService.instance) {
      ClaudeCodeVersionService.instance = new ClaudeCodeVersionService();
    }
    return ClaudeCodeVersionService.instance;
  }

  static resetForTesting(): void {
    ClaudeCodeVersionService.instance?.stopAutoRefresh();
    ClaudeCodeVersionService.instance = new ClaudeCodeVersionService();
  }

  /**
   * Refresh the Claude Code CLI version on a schedule (same 60-minute
   * cadence as the Codex version and model metadata), so a long-running
   * instance never serves a stale version. Anthropic gates new models on
   * this version (`claude_code_version_too_old`), so staleness blocks
   * newly released models.
   */
  startAutoRefresh(intervalMinutes = 60): void {
    this.stopAutoRefresh();
    const minutes = Math.max(1, intervalMinutes);
    this.autoRefreshIntervalMinutes = minutes;
    this.autoRefreshTimer = setInterval(
      () => {
        this.fetchVersion()
          .then((error) => {
            if (error) {
              logger.error('Scheduled claude-code version refresh failed', error);
            }
          })
          .catch((error) => {
            logger.error('Scheduled claude-code version refresh failed', error);
          });
      },
      minutes * 60 * 1000
    );
    logger.info(`Scheduled claude-code version auto-refresh every ${minutes} minutes`);
  }

  /** Current auto-refresh cadence in minutes (default 60). */
  getAutoRefreshIntervalMinutes(): number {
    return this.autoRefreshIntervalMinutes;
  }

  stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  async fetchVersion(): Promise<string | undefined> {
    try {
      const response = await fetch(NPM_DIST_TAGS_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'plexus-gateway',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const error = `npm registry returned status ${response.status}`;
        logger.debug(error);
        return error;
      }

      const data = (await response.json()) as NpmDistTags;
      const latest = data.latest;
      if (typeof latest !== 'string' || !SEMVER.test(latest)) {
        const error = 'npm dist-tags response missing a valid latest tag';
        logger.debug(`${error}, ignoring: ${JSON.stringify(data)}`);
        return error;
      }

      this.version = latest;
      logger.debug(`Resolved claude-code version: ${latest}`);
      return undefined;
    } catch (error) {
      const message = `Failed to fetch claude-code version from npm: ${String(error)}. Using fallback: ${this.version}`;
      logger.warn(message);
      return message;
    }
  }

  getVersion(): string {
    return this.version;
  }
}
