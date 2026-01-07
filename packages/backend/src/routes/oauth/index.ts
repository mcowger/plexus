import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OAuthService } from '../../services/oauth-service.js';
import { UsageStorageService } from '../../services/usage-storage.js';
import { TokenRefreshService } from '../../services/token-refresh-service.js';
import { logger } from '../../utils/logger.js';

export async function oauthRoutes(
  fastify: FastifyInstance,
  oauthService: OAuthService,
  usageStorage: UsageStorageService,
  tokenRefreshService?: TokenRefreshService
) {
  // Initiate OAuth flow
  fastify.get('/v0/oauth/authorize', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.query as { provider?: string };

    if (!provider) {
      return reply.status(400).send({ error: 'Missing provider parameter' });
    }

    if (provider !== 'antigravity') {
      return reply.status(400).send({ error: 'Unsupported provider' });
    }

    const state = oauthService.generateState();
    oauthService.registerSession(provider, state);

    const authUrl = oauthService.buildAntigravityAuthUrl(state);

    logger.info(`OAuth flow initiated for provider: ${provider}`);

    return reply.send({
      auth_url: authUrl,
      instructions: 'Visit the auth_url to complete OAuth flow',
    });
  });

  // OAuth callback handler
  fastify.get('/v0/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { code, state, error } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (error) {
      logger.error(`OAuth error: ${error}`);
      return reply.status(400).send({
        success: false,
        error: `OAuth error: ${error}`,
      });
    }

    if (!code || !state) {
      return reply.status(400).send({
        success: false,
        error: 'Missing code or state parameter',
      });
    }

    // Validate state
    const session = oauthService.validateState(state);
    if (!session) {
      logger.warn('Invalid or expired OAuth state');
      return reply.status(400).send({
        success: false,
        error: 'Invalid or expired state',
      });
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await oauthService.exchangeAntigravityCode(code);

      // Fetch user info
      const userInfo = await oauthService.fetchUserInfo(tokenResponse.access_token);
      const email = userInfo.email || 'unknown';

      // Fetch project ID
      let projectId = '';
      try {
        projectId = await oauthService.fetchProjectId(tokenResponse.access_token);
        logger.info(`Fetched project ID: ${projectId} for user: ${email}`);
      } catch (err) {
        logger.warn('Failed to fetch project ID:', err);
      }

      // Calculate expiry timestamp
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

      // Save to database
      usageStorage.saveOAuthCredential({
        provider: 'antigravity',
        user_identifier: email,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        token_type: tokenResponse.token_type,
        expires_at: expiresAt,
        scope: 'cloud-platform userinfo.email userinfo.profile cclog experimentsandconfigs',
        project_id: projectId,
        metadata: JSON.stringify({ email }),
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      logger.info(`OAuth credentials saved for ${email}`);

      return reply.type('text/html').send(`
        <html>
          <head>
            <title>OAuth Success</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 20px;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                max-width: 600px;
                text-align: center;
              }
              h1 {
                color: #2d3748;
                margin-top: 0;
              }
              h2 {
                color: #2d3748;
                margin-top: 30px;
                margin-bottom: 15px;
                font-size: 1.25rem;
              }
              p {
                color: #4a5568;
                line-height: 1.6;
                margin: 10px 0;
              }
              .success-icon {
                font-size: 48px;
                margin-bottom: 20px;
              }
              strong {
                color: #2d3748;
              }
              .info-box {
                background: #f7fafc;
                border: 1px solid #e2e8f0;
                border-radius: 6px;
                padding: 20px;
                margin-top: 20px;
                text-align: left;
              }
              .code-block {
                background: #2d3748;
                color: #e2e8f0;
                padding: 15px;
                border-radius: 6px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
                text-align: left;
                overflow-x: auto;
                margin-top: 10px;
                white-space: pre;
              }
              .link {
                color: #667eea;
                text-decoration: none;
                font-weight: 500;
              }
              .link:hover {
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✓</div>
              <h1>Authentication Successful</h1>
              <p>Authenticated as: <strong>${email}</strong></p>
              ${projectId ? `<p>Project ID: <strong>${projectId}</strong></p>` : ''}

              <div class="info-box">
                <h2>⚠️ Important: Configure Provider & Model</h2>
                <p>OAuth authentication is now set up, but <strong>you must configure a provider and model</strong> in your config to use it.</p>

                <p><strong>Option 1:</strong> Use the <a href="/providers" class="link">Providers UI</a> to configure via the web interface.</p>

                <p><strong>Option 2:</strong> Add to your YAML config:</p>
                <div class="code-block">providers:
  my-antigravity:
    type: gemini
    oauth_provider: antigravity
    oauth_account_pool:
      - ${email}
      # Add more accounts here for load balancing
    models:
      gemini-2.0-flash-thinking-exp:
        pricing:
          source: simple
          input: 0
          output: 0
        access_via: [gemini]

models:
  gemini-thinking:
    targets:
      - provider: my-antigravity
        model: gemini-2.0-flash-thinking-exp</div>
                <p style="margin-top: 15px; font-size: 0.9em; color: #718096;">
                  <strong>Note:</strong> The <code>oauth_account_pool</code> must list all authenticated account emails. Add multiple accounts for automatic load balancing with per-account cooldowns.
                </p>
              </div>

              <p style="margin-top: 30px;">You can close this window and return to your application.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      logger.error('OAuth callback error:', err);
      return reply.status(500).send({
        success: false,
        error: 'Failed to complete OAuth flow',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // List OAuth credentials (management endpoint)
  fastify.get('/v0/oauth/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.query as { provider?: string };

    // This would need proper authentication in production
    const credential = usageStorage.getOAuthCredential(
      provider || 'antigravity'
    );

    if (!credential) {
      return reply.status(404).send({ error: 'No credentials found' });
    }

    // Don't expose tokens in response
    return reply.send({
      provider: credential.provider,
      user_identifier: credential.user_identifier,
      expires_at: credential.expires_at,
      project_id: credential.project_id,
      is_expired: Date.now() >= credential.expires_at,
      expires_in_seconds: Math.max(0, Math.floor((credential.expires_at - Date.now()) / 1000)),
    });
  });

  // List all OAuth credentials grouped by provider (for multi-account UI)
  fastify.get('/v0/oauth/credentials/grouped', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.query as { provider?: string };

    // Get all providers or filter by specific provider
    const providers = provider ? [provider] : ['antigravity', 'claude-code'];

    const result = [];
    const now = Date.now();

    for (const providerName of providers) {
      const credentials = usageStorage.getAllOAuthCredentials(providerName);

      if (credentials.length === 0) {
        result.push({
          provider: providerName,
          accounts: [],
        });
        continue;
      }

      // Get cooldown info for each account
      const { CooldownManager } = await import('../../services/cooldown-manager.js');
      const cooldownManager = CooldownManager.getInstance();
      const allCooldowns = cooldownManager.getCooldowns();

      const accounts = credentials.map(cred => {
        const expiresInSeconds = Math.max(0, Math.floor((cred.expires_at - now) / 1000));
        const isExpired = now >= cred.expires_at;
        const isExpiringSoon = now >= (cred.expires_at - 10 * 60 * 1000); // Within 10 minutes

        // Check if this account is on cooldown
        const accountCooldown = allCooldowns.find(
          cd => cd.provider === providerName && cd.accountId === cred.user_identifier
        );

        let status: 'active' | 'expiring' | 'expired' | 'cooldown';
        if (accountCooldown) {
          status = 'cooldown';
        } else if (isExpired) {
          status = 'expired';
        } else if (isExpiringSoon) {
          status = 'expiring';
        } else {
          status = 'active';
        }

        // Calculate refresh token age (time since last refresh)
        const lastRefreshedAt = cred.last_refreshed_at || cred.created_at;
        const tokenAgeSeconds = Math.floor((now - lastRefreshedAt) / 1000);

        // Calculate refresh token expiry based on provider
        let refreshTokenExpiresAt: number;
        let refreshTokenExpiresInSeconds: number;

        if (providerName === 'claude-code') {
          // Claude Code refresh tokens expire after 90 days
          const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
          refreshTokenExpiresAt = lastRefreshedAt + ninetyDaysMs;
          refreshTokenExpiresInSeconds = Math.max(0, Math.floor((refreshTokenExpiresAt - now) / 1000));
        } else {
          // Google OAuth refresh tokens expire after 6 months of inactivity
          const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 months
          refreshTokenExpiresAt = lastRefreshedAt + sixMonthsMs;
          refreshTokenExpiresInSeconds = Math.max(0, Math.floor((refreshTokenExpiresAt - now) / 1000));
        }

        return {
          user_identifier: cred.user_identifier,
          expires_at: cred.expires_at,
          expires_in_seconds: expiresInSeconds,
          is_expired: isExpired,
          project_id: cred.project_id,
          on_cooldown: !!accountCooldown,
          cooldown_expiry: accountCooldown?.expiry,
          cooldown_remaining_seconds: accountCooldown
            ? Math.ceil(accountCooldown.timeRemainingMs / 1000)
            : undefined,
          status,
          last_refreshed_at: lastRefreshedAt,
          token_age_seconds: tokenAgeSeconds,
          refresh_token_expires_at: refreshTokenExpiresAt,
          refresh_token_expires_in_seconds: refreshTokenExpiresInSeconds,
        };
      });

      result.push({
        provider: providerName,
        accounts,
      });
    }

    return reply.send({
      providers: result,
    });
  });

  // Delete OAuth credentials (management endpoint)
  fastify.delete('/v0/oauth/credentials', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider, user_identifier } = request.query as {
      provider?: string;
      user_identifier?: string;
    };

    if (!provider || !user_identifier) {
      return reply.status(400).send({ error: 'Missing parameters' });
    }

    const deleted = usageStorage.deleteOAuthCredential(provider, user_identifier);

    if (deleted) {
      logger.info(`OAuth credentials deleted for ${provider}:${user_identifier}`);
      return reply.send({ success: true });
    } else {
      return reply.status(404).send({ success: false, error: 'Credentials not found' });
    }
  });

  // OAuth status endpoint (for UI)
  fastify.get('/v0/oauth/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider } = request.query as { provider?: string };

    const credentials = usageStorage.getOAuthCredential(provider || 'antigravity');

    if (!credentials) {
      const externalUrl = process.env.EXTERNAL_PLEXUS_URL || 'http://localhost:4000';
      const baseUrl = externalUrl.endsWith('/') ? externalUrl.slice(0, -1) : externalUrl;
      
      return reply.send({
        configured: false,
        message: 'OAuth not configured',
        auth_url: `${baseUrl}/v0/oauth/authorize?provider=${provider || 'antigravity'}`,
      });
    }

    const isExpired = Date.now() >= credentials.expires_at;
    const expiresIn = Math.max(0, credentials.expires_at - Date.now());

    return reply.send({
      configured: true,
      provider: credentials.provider,
      user: credentials.user_identifier,
      project_id: credentials.project_id,
      expires_at: credentials.expires_at,
      expires_in_seconds: Math.floor(expiresIn / 1000),
      is_expired: isExpired,
    });
  });

  // Manually trigger token refresh
  fastify.post('/v0/oauth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!tokenRefreshService) {
      return reply.status(503).send({
        success: false,
        error: 'Token refresh service not available',
      });
    }

    try {
      await tokenRefreshService.triggerRefresh();
      return reply.send({
        success: true,
        message: 'Token refresh triggered',
      });
    } catch (error) {
      logger.error('Failed to trigger token refresh:', error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to trigger token refresh',
      });
    }
  });

  // Get token refresh service status
  fastify.get('/v0/oauth/refresh/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!tokenRefreshService) {
      return reply.status(503).send({
        available: false,
        message: 'Token refresh service not available',
      });
    }

    const status = tokenRefreshService.getStatus();
    return reply.send({
      available: true,
      ...status,
    });
  });

  logger.info('OAuth routes registered');
}
