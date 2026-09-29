import { logger } from '../../utils/logger';

const DEFAULT_CODEX_VERSION = '0.155.1';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/openai/codex/releases/latest';

interface GitHubRelease {
  tag_name?: string;
}

export class CodexVersionService {
  private static instance: CodexVersionService;
  private version: string;
  private autoRefreshIntervalMinutes = 60;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.version = DEFAULT_CODEX_VERSION;
  }

  static getInstance(): CodexVersionService {
    if (!CodexVersionService.instance) {
      CodexVersionService.instance = new CodexVersionService();
    }
    return CodexVersionService.instance;
  }

  static resetForTesting(): void {
    CodexVersionService.instance?.stopAutoRefresh();
    CodexVersionService.instance = new CodexVersionService();
  }

  /**
   * Refresh the Codex CLI version on a schedule (same 60-minute cadence as
   * model metadata), so a long-running instance never serves a stale version.
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
              logger.error('Scheduled codex version refresh failed', error);
            }
          })
          .catch((error) => {
            logger.error('Scheduled codex version refresh failed', error);
          });
      },
      minutes * 60 * 1000
    );
    logger.info(`Scheduled codex version auto-refresh every ${minutes} minutes`);
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
      const response = await fetch(GITHUB_RELEASES_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'plexus-gateway',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const error = `GitHub API returned status ${response.status}`;
        logger.debug(error);
        return error;
      }

      const data = (await response.json()) as GitHubRelease;
      const tag = data.tag_name;
      if (!tag) {
        const error = 'GitHub release response missing tag_name';
        logger.debug(error);
        return error;
      }

      // Extract semver from anywhere in the tag (handles prefixed tags like "rust-v0.128.0").
      const match = tag.match(/(\d+\.\d+\.\d+)/);
      if (!match?.[1]) {
        const error = `Unexpected tag format: ${tag}, ignoring`;
        logger.debug(error);
        return error;
      }

      this.version = match[1];
      logger.debug(`Resolved codex version: ${match[1]}`);
      return undefined;
    } catch (error) {
      const message = `Failed to fetch codex version from GitHub: ${String(error)}. Using fallback: ${DEFAULT_CODEX_VERSION}`;
      logger.warn(message);
      return message;
    }
  }

  getVersion(): string {
    return this.version;
  }

  getUserAgent(): string {
    return `codex_cli_rs/${this.version} (Debian 13.0.0; x86_64) WindowsTerminal`;
  }
}
