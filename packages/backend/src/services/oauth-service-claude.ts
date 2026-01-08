import pkceChallenge from 'pkce-challenge';
import { UsageStorageService } from './usage-storage.js';
import { logger } from '../utils/logger.js';
import http from 'http';

interface ClaudeOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

interface ClaudeTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  organization: {
    uuid: string;
    name: string;
  };
  account: {
    uuid: string;
    email_address: string;
  };
}

interface PKCECodes {
  code_verifier: string;
  code_challenge: string;
}

interface ClaudeOAuthSession {
  state: string;
  codeVerifier: string;
  createdAt: number;
  expiresAt: number;
}

export class ClaudeOAuthService {
  private sessions: Map<string, ClaudeOAuthSession> = new Map();
  private readonly SESSION_TTL = 10 * 60 * 1000; // 10 minutes
  private loopbackServer: http.Server | null = null;
  private readonly LOOPBACK_PORT = 54545;

  private readonly config: ClaudeOAuthConfig = {
    authorizationUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    redirectUri: '',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
  };

  constructor(
    private usageStorage: UsageStorageService,
    private externalUrl: string
  ) {
    // Ensure externalUrl does not have a trailing slash
    if (this.externalUrl.endsWith('/')) {
      this.externalUrl = this.externalUrl.slice(0, -1);
    }

    // Configure redirect URI to use the fixed localhost callback required by Claude Code
    // strictly for the initial OAuth handshake. Our loopback server will catch this
    // and redirect to the actual Plexus backend.
    this.config.redirectUri = `http://localhost:${this.LOOPBACK_PORT}/callback`;

    // Clean up expired sessions every 5 minutes
    setInterval(() => this.cleanExpiredSessions(), 5 * 60 * 1000);

    // Start the loopback server
    this.startLoopbackServer();
  }

  /**
   * Generate PKCE codes using the pkce-challenge library
   */
  async generatePKCECodes(): Promise<PKCECodes> {
    const { code_verifier, code_challenge } = await pkceChallenge();
    return { code_verifier, code_challenge };
  }

  /**
   * Generate a random state token for CSRF protection
   */
  generateState(): string {
    return crypto.randomUUID();
  }

  /**
   * Register an OAuth session with state and PKCE verifier
   */
  registerSession(state: string, codeVerifier: string): void {
    const now = Date.now();
    this.sessions.set(state, {
      state,
      codeVerifier,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL,
    });
    logger.info(`Registered Claude OAuth session: ${state}`);
  }

  /**
   * Validate and retrieve session data, consuming the session
   */
  validateAndConsumeSession(state: string): ClaudeOAuthSession | null {
    const session = this.sessions.get(state);
    if (!session) {
      logger.warn(`Invalid state token: ${state}`);
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(state);
      logger.warn(`Expired state token: ${state}`);
      return null;
    }

    // Consume the session (one-time use)
    this.sessions.delete(state);
    return session;
  }

  /**
   * Generate the authorization URL with PKCE challenge
   */
  generateAuthorizationUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${this.config.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  async exchangeCodeForTokens(
    code: string,
    state: string,
    codeVerifier: string
  ): Promise<ClaudeTokenResponse> {
    const body = {
      code,
      state,
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    };

    logger.info('Exchanging authorization code for tokens');

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Token exchange failed: ${response.status} ${errorText}`);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenResponse: ClaudeTokenResponse = await response.json();
    logger.info(`Token exchange successful for user: ${tokenResponse.account.email_address}`);

    return tokenResponse;
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<ClaudeTokenResponse> {
    const body = {
      client_id: this.config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    logger.info('Refreshing Claude Code access token');

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Token refresh failed: ${response.status} ${errorText}`);
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const tokenResponse: ClaudeTokenResponse = await response.json();
    logger.info('Token refresh successful');

    return tokenResponse;
  }

  /**
   * Store OAuth credentials in the database
   */
  async storeCredentials(tokenResponse: ClaudeTokenResponse): Promise<void> {
    const now = Date.now();
    const expiresAt = now + tokenResponse.expires_in * 1000;
    const metadata = {
      organization_uuid: tokenResponse.organization.uuid,
      organization_name: tokenResponse.organization.name,
      account_uuid: tokenResponse.account.uuid,
    };

    this.usageStorage.saveOAuthCredential({
      provider: 'claude-code',
      user_identifier: tokenResponse.account.email_address,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      token_type: tokenResponse.token_type,
      expires_at: expiresAt,
      metadata: JSON.stringify(metadata),
      created_at: now,
      updated_at: now,
    });

    logger.info(`Stored credentials for ${tokenResponse.account.email_address}`);
  }

  /**
   * Update OAuth token in the database
   */
  async updateToken(
    email: string,
    accessToken: string,
    expiresAtMs: number,
    refreshToken?: string
  ): Promise<void> {
    this.usageStorage.updateOAuthToken(
      'claude-code',
      email,
      accessToken,
      expiresAtMs,
      refreshToken
    );
    logger.info(`Updated token for ${email}`);
  }

  /**
   * Delete OAuth credentials from the database
   */
  async deleteCredentials(email: string): Promise<void> {
    await this.usageStorage.deleteOAuthCredential('claude-code', email);
    logger.info(`Deleted credentials for ${email}`);
  }

  /**
   * Get all Claude Code OAuth accounts
   */
  getAccounts(): any[] {
    return this.usageStorage.getAllOAuthCredentials('claude-code');
  }

  /**
   * Clean up expired sessions
   */
  private cleanExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [state, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(state);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired OAuth sessions`);
    }
  }

  /**
   * Start a lightweight loopback server on port 54545 to handle OAuth callbacks
   */
  private startLoopbackServer(): void {
    if (this.loopbackServer) {
      return; // Already running
    }

    this.loopbackServer = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${this.LOOPBACK_PORT}`);

      if (url.pathname === '/callback') {
        // Serve HTML page that extracts code and redirects to our backend
        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Claude Code OAuth Callback</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    .spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Completing authentication...</p>
  </div>
  <script>
    // Extract OAuth parameters from URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      window.location.href = '${this.externalUrl}/v0/oauth/claude/callback?error=' + encodeURIComponent(error);
    } else if (code && state) {
      // Redirect to our backend with the code and state
      window.location.href = '${this.externalUrl}/v0/oauth/claude/callback?code=' +
        encodeURIComponent(code) + '&state=' + encodeURIComponent(state);
    } else {
      window.location.href = '${this.externalUrl}/v0/oauth/claude/callback?error=missing_parameters';
    }
  </script>
</body>
</html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    this.loopbackServer.listen(this.LOOPBACK_PORT, '0.0.0.0', () => {
      logger.info(`Claude OAuth loopback server listening on 0.0.0.0:${this.LOOPBACK_PORT}`);
    });

    this.loopbackServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Port ${this.LOOPBACK_PORT} already in use, loopback server may already be running`);
      } else {
        logger.error('Loopback server error:', err);
      }
    });
  }

  /**
   * Stop the loopback server
   */
  stopLoopbackServer(): void {
    if (this.loopbackServer) {
      this.loopbackServer.close();
      this.loopbackServer = null;
      logger.info('Claude OAuth loopback server stopped');
    }
  }
}
