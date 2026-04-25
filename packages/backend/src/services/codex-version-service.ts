import { logger } from '../utils/logger';

const DEFAULT_CODEX_VERSION = '0.125.0';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/openai/codex/releases/latest';

interface GitHubRelease {
  tag_name?: string;
}

export class CodexVersionService {
  private static instance: CodexVersionService;
  private version: string;

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
    CodexVersionService.instance = new CodexVersionService();
  }

  async fetchVersion(): Promise<void> {
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
        logger.debug(`[CodexVersionService] GitHub API returned status ${response.status}`);
        return;
      }

      const data = (await response.json()) as GitHubRelease;
      const tag = data.tag_name;
      if (!tag) return;

      const version = tag.replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+/.test(version)) {
        logger.debug(`[CodexVersionService] Unexpected tag format: ${tag}, ignoring`);
        return;
      }

      this.version = version;
      logger.info(`[CodexVersionService] Resolved codex version: ${version}`);
    } catch (error) {
      logger.warn(
        `[CodexVersionService] Failed to fetch codex version from GitHub: ${String(error)}. Using fallback: ${DEFAULT_CODEX_VERSION}`
      );
    }
  }

  getVersion(): string {
    return this.version;
  }

  getUserAgent(): string {
    return `codex_cli_rs/${this.version} (Debian 13.0.0; x86_64) WindowsTerminal`;
  }
}
