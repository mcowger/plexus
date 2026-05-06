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
        logger.debug(`GitHub API returned status ${response.status}`);
        return;
      }

      const data = (await response.json()) as GitHubRelease;
      const tag = data.tag_name;
      if (!tag) return;

      // Extract semver from anywhere in the tag (handles prefixed tags like "rust-v0.128.0").
      const match = tag.match(/(\d+\.\d+\.\d+)/);
      if (!match?.[1]) {
        logger.debug(`Unexpected tag format: ${tag}, ignoring`);
        return;
      }

      this.version = match[1];
      logger.debug(`Resolved codex version: ${match[1]}`);
    } catch (error) {
      logger.warn(
        `Failed to fetch codex version from GitHub: ${String(error)}. Using fallback: ${DEFAULT_CODEX_VERSION}`
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
