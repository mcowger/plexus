import { logger } from '../utils/logger';

const DEFAULT_CODEX_VERSION = '0.125.0';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/openai/codex/releases/latest';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface GitHubRelease {
  tag_name?: string;
}

export class CodexVersionService {
  private static instance: CodexVersionService;
  private cachedVersion: string | null = null;
  private lastFetchTime = 0;

  private constructor() {}

  static getInstance(): CodexVersionService {
    if (!CodexVersionService.instance) {
      CodexVersionService.instance = new CodexVersionService();
    }
    return CodexVersionService.instance;
  }

  static resetForTesting(): void {
    CodexVersionService.instance = new CodexVersionService();
  }

  async getVersion(): Promise<string> {
    const now = Date.now();
    if (this.cachedVersion && now - this.lastFetchTime < CACHE_TTL_MS) {
      return this.cachedVersion;
    }

    try {
      const version = await this.fetchLatestVersion();
      if (version) {
        this.cachedVersion = version;
        this.lastFetchTime = now;
        logger.info(`[CodexVersionService] Resolved codex version: ${version}`);
        return version;
      }
    } catch (error) {
      logger.warn(
        `[CodexVersionService] Failed to fetch codex version from GitHub: ${String(error)}. Using fallback: ${DEFAULT_CODEX_VERSION}`
      );
    }

    if (!this.cachedVersion) {
      this.cachedVersion = DEFAULT_CODEX_VERSION;
      this.lastFetchTime = now;
    }

    return this.cachedVersion;
  }

  getUserAgent(): string {
    const version = this.cachedVersion || DEFAULT_CODEX_VERSION;
    return `codex_cli_rs/${version} (Debian 13.0.0; x86_64) WindowsTerminal`;
  }

  async refresh(): Promise<string> {
    this.lastFetchTime = 0;
    return this.getVersion();
  }

  private async fetchLatestVersion(): Promise<string | null> {
    const response = await fetch(GITHUB_RELEASES_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'plexus-gateway',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      logger.debug(`[CodexVersionService] GitHub API returned status ${response.status}`);
      return null;
    }

    const data = (await response.json()) as GitHubRelease;
    const tag = data.tag_name;
    if (!tag) {
      return null;
    }

    const version = tag.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+/.test(version)) {
      logger.debug(`[CodexVersionService] Unexpected tag format: ${tag}, skipping`);
      return null;
    }

    return version;
  }
}
