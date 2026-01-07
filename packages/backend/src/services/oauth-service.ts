import crypto from 'crypto';
import { UsageStorageService } from './usage-storage.js';
import { logger } from '../utils/logger.js';

interface OAuthSessionState {
  provider: string;
  state: string;
  createdAt: number;
  expiresAt: number;
  returnUrl?: string;
}

export class OAuthService {
  private sessions: Map<string, OAuthSessionState> = new Map();
  private readonly SESSION_TTL = 10 * 60 * 1000; // 10 minutes

  // Default OAuth credentials (can be overridden via environment variables)
  private readonly ANTIGRAVITY_CLIENT_ID =
    process.env.ANTIGRAVITY_CLIENT_ID ||
    '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
  private readonly ANTIGRAVITY_CLIENT_SECRET =
    process.env.ANTIGRAVITY_CLIENT_SECRET ||
    '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';

  constructor(
    private usageStorage: UsageStorageService,
    private externalUrl: string
  ) {
    // Ensure externalUrl does not have a trailing slash
    if (this.externalUrl.endsWith('/')) {
      this.externalUrl = this.externalUrl.slice(0, -1);
    }

    // Clean up expired sessions every 5 minutes
    setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);
  }

  // Generate CSRF state token
  generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // Register OAuth session
  registerSession(provider: string, state: string): void {
    const now = Date.now();
    this.sessions.set(state, {
      provider,
      state,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL,
    });
  }

  // Validate and consume state
  validateState(state: string): OAuthSessionState | null {
    const session = this.sessions.get(state);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(state);
      return null;
    }
    this.sessions.delete(state); // Consume state
    return session;
  }

  // Build Antigravity OAuth URL
  buildAntigravityAuthUrl(state: string): string {
    const params = new URLSearchParams({
      access_type: 'offline',
      client_id: this.ANTIGRAVITY_CLIENT_ID,
      prompt: 'consent',
      redirect_uri: 'http://localhost:4000/v0/oauth/callback',
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs',
      ].join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  // Exchange authorization code for tokens
  async exchangeAntigravityCode(code: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }> {
    const params = new URLSearchParams({
      code,
      client_id: this.ANTIGRAVITY_CLIENT_ID,
      client_secret: this.ANTIGRAVITY_CLIENT_SECRET,
      redirect_uri: 'http://localhost:4000/v0/oauth/callback',
      grant_type: 'authorization_code',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return response.json();
  }

  // Fetch user info from Google
  async fetchUserInfo(accessToken: string): Promise<{ email: string }> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) return { email: '' };
    return response.json();
  }

  // Fetch Antigravity project ID
  async fetchProjectId(accessToken: string): Promise<string> {
    const response = await fetch(
      'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch project ID');
    }

    const data = await response.json();
    return data.cloudaicompanionProject || '';
  }

  // Refresh OAuth token
  async refreshToken(provider: string, refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    token_type: string;
  }> {
    if (provider !== 'antigravity') {
      throw new Error(`Refresh not implemented for provider: ${provider}`);
    }

    const params = new URLSearchParams({
      client_id: this.ANTIGRAVITY_CLIENT_ID,
      client_secret: this.ANTIGRAVITY_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return response.json();
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [state, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(state);
      }
    }
  }
}
