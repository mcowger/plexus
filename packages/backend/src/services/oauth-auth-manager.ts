import fs from 'fs';
import { getAuthJsonPath } from '../config';
import { logger } from '../utils/logger';
import {
  getOAuthApiKey,
  type OAuthProvider,
  type OAuthCredentials
} from '@mariozechner/pi-ai';

type AuthRecord = Record<string, OAuthCredentials>;

export class OAuthAuthManager {
  private static instance: OAuthAuthManager;
  private authData: AuthRecord = {};
  private authFilePath: string;

  private constructor() {
    this.authFilePath = getAuthJsonPath();
    this.loadAuthFile();
  }

  static getInstance(): OAuthAuthManager {
    if (!this.instance) {
      this.instance = new OAuthAuthManager();
    }
    return this.instance;
  }

  static resetForTesting(): void {
    this.instance = undefined as unknown as OAuthAuthManager;
  }

  private loadAuthFile(): void {
    try {
      if (fs.existsSync(this.authFilePath)) {
        const content = fs.readFileSync(this.authFilePath, 'utf-8');
        this.authData = JSON.parse(content) as AuthRecord;
        logger.info(`OAuth: Loaded credentials from ${this.authFilePath}`);
      } else {
        logger.warn(
          `OAuth: No auth.json found at ${this.authFilePath}. OAuth providers will not be available.`
        );
      }
    } catch (error: any) {
      logger.error(`OAuth: Failed to load ${this.authFilePath}:`, error);
      throw new Error(`Failed to load OAuth credentials: ${error?.message || error}`);
    }
  }

  private saveAuthFile(): void {
    try {
      fs.writeFileSync(
        this.authFilePath,
        JSON.stringify(this.authData, null, 2),
        'utf-8'
      );
      logger.debug(`OAuth: Saved updated credentials to ${this.authFilePath}`);
    } catch (error) {
      logger.error(`OAuth: Failed to save ${this.authFilePath}:`, error);
    }
  }

  setCredentials(provider: OAuthProvider, credentials: OAuthCredentials): void {
    this.authData[provider] = { type: 'oauth', ...credentials } as OAuthCredentials;
    this.saveAuthFile();
  }

  async getApiKey(provider: OAuthProvider): Promise<string> {
    const result = await getOAuthApiKey(provider, this.authData);

    if (!result) {
      throw new Error(
        `OAuth: Not authenticated for provider '${provider}'. ` +
          `Please run: npx @mariozechner/pi-ai login ${provider}`
      );
    }

    if (result.newCredentials) {
      this.authData[provider] = { type: 'oauth', ...result.newCredentials } as OAuthCredentials;
      this.saveAuthFile();
    }

    return result.apiKey;
  }

  hasProvider(provider: OAuthProvider): boolean {
    return !!this.authData[provider];
  }

  reload(): void {
    this.loadAuthFile();
  }
}
