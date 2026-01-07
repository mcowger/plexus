import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ClaudeOAuthService } from '../../services/oauth-service-claude.js';
import { logger } from '../../utils/logger.js';

export async function claudeOAuthRoutes(
  fastify: FastifyInstance,
  claudeOAuthService: ClaudeOAuthService
) {
  // Initiate Claude Code OAuth flow
  fastify.post(
    '/v0/oauth/claude/authorize',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Generate PKCE codes
        const { code_verifier, code_challenge } = await claudeOAuthService.generatePKCECodes();

        // Generate state token
        const state = claudeOAuthService.generateState();

        // Register session
        claudeOAuthService.registerSession(state, code_verifier);

        // Generate authorization URL
        const authUrl = claudeOAuthService.generateAuthorizationUrl(state, code_challenge);

        logger.info('Claude Code OAuth flow initiated');

        return reply.send({
          auth_url: authUrl,
          state,
        });
      } catch (error) {
        logger.error('Failed to initiate Claude OAuth flow:', error);
        return reply.status(500).send({
          error: 'Failed to initiate OAuth flow',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // OAuth callback handler
  fastify.get(
    '/v0/oauth/claude/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code, state, error } = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (error) {
        logger.error(`Claude OAuth error: ${error}`);
        return reply.type('text/html').send(`
          <html>
            <head>
              <title>OAuth Error</title>
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
                  color: #e53e3e;
                  margin-top: 0;
                }
                p {
                  color: #4a5568;
                  line-height: 1.6;
                }
                .error-icon {
                  font-size: 48px;
                  margin-bottom: 20px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error-icon">✗</div>
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>Please close this window and try again.</p>
              </div>
            </body>
          </html>
        `);
      }

      if (!code || !state) {
        return reply.status(400).send({
          success: false,
          error: 'Missing code or state parameter',
        });
      }

      // Validate and consume session
      const session = claudeOAuthService.validateAndConsumeSession(state);
      if (!session) {
        logger.warn('Invalid or expired Claude OAuth state');
        return reply.type('text/html').send(`
          <html>
            <head>
              <title>OAuth Error</title>
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
                  color: #e53e3e;
                  margin-top: 0;
                }
                p {
                  color: #4a5568;
                  line-height: 1.6;
                }
                .error-icon {
                  font-size: 48px;
                  margin-bottom: 20px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error-icon">✗</div>
                <h1>Session Expired</h1>
                <p>Your OAuth session has expired or is invalid.</p>
                <p>Please close this window and start the authentication process again.</p>
              </div>
            </body>
          </html>
        `);
      }

      try {
        // Exchange code for tokens
        const tokenResponse = await claudeOAuthService.exchangeCodeForTokens(
          code,
          state,
          session.codeVerifier
        );

        // Store credentials
        await claudeOAuthService.storeCredentials(tokenResponse);

        logger.info(`Claude Code OAuth successful for ${tokenResponse.account.email_address}`);

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
                <p>Authenticated as: <strong>${tokenResponse.account.email_address}</strong></p>
                <p>Organization: <strong>${tokenResponse.organization.name}</strong></p>

                <div class="info-box">
                  <h2>⚠️ Important: Configure Provider</h2>
                  <p>OAuth authentication is now set up, but <strong>you must configure a provider</strong> in your config to use it.</p>

                  <p><strong>Option 1:</strong> Use the <a href="/providers" class="link">Providers UI</a> to configure via the web interface.</p>

                  <p><strong>Option 2:</strong> Add to your YAML config:</p>
                  <div class="code-block">providers:
  my-claude-code:
    type: messages
    api_base_url: https://api.anthropic.com/v1
    oauth_provider: claude-code
    oauth_account_pool:
      - ${tokenResponse.account.email_address}
      # Add more accounts here for load balancing
    models:
      claude-sonnet-4-5:
        pricing:
          source: simple
          input: 0.003
          output: 0.015
        access_via: [messages]
      claude-opus-4-5:
        pricing:
          source: simple
          input: 0.015
          output: 0.075
        access_via: [messages]

models:
  claude-sonnet:
    targets:
      - provider: my-claude-code
        model: claude-sonnet-4-5</div>
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
        logger.error('Claude OAuth callback error:', err);
        return reply.type('text/html').send(`
          <html>
            <head>
              <title>OAuth Error</title>
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
                  color: #e53e3e;
                  margin-top: 0;
                }
                p {
                  color: #4a5568;
                  line-height: 1.6;
                }
                .error-icon {
                  font-size: 48px;
                  margin-bottom: 20px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error-icon">✗</div>
                <h1>Authentication Failed</h1>
                <p>Failed to complete OAuth flow</p>
                <p style="font-size: 0.9em;">${err instanceof Error ? err.message : String(err)}</p>
                <p>Please close this window and try again.</p>
              </div>
            </body>
          </html>
        `);
      }
    }
  );

  // Get all Claude Code accounts
  fastify.get(
    '/v0/oauth/claude/accounts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const accounts = claudeOAuthService.getAccounts();

        // Get cooldown info
        const { CooldownManager } = await import('../../services/cooldown-manager.js');
        const cooldownManager = CooldownManager.getInstance();
        const allCooldowns = cooldownManager.getCooldowns();

        const now = Date.now();
        const formattedAccounts = accounts.map(account => {
          const expiresInSeconds = Math.max(
            0,
            Math.floor((account.expires_at * 1000 - now) / 1000)
          );
          const isExpired = now >= account.expires_at * 1000;

          // Check cooldown status
          const accountCooldown = allCooldowns.find(
            cd => cd.provider === 'claude-code' && cd.accountId === account.user_identifier
          );

          let status: 'active' | 'expired' | 'cooldown';
          if (accountCooldown) {
            status = 'cooldown';
          } else if (isExpired) {
            status = 'expired';
          } else {
            status = 'active';
          }

          // Parse metadata
          let metadata = {};
          try {
            metadata = JSON.parse(account.metadata || '{}');
          } catch (e) {
            logger.warn(`Failed to parse metadata for ${account.user_identifier}`);
          }

          return {
            email: account.user_identifier,
            organization_name: (metadata as any).organization_name || '',
            organization_uuid: (metadata as any).organization_uuid || '',
            account_uuid: (metadata as any).account_uuid || '',
            expires_at: account.expires_at * 1000,
            expires_in_seconds: expiresInSeconds,
            is_expired: isExpired,
            on_cooldown: !!accountCooldown,
            cooldown_remaining_seconds: accountCooldown
              ? Math.ceil(accountCooldown.timeRemainingMs / 1000)
              : undefined,
            status,
            last_refreshed_at: account.last_refreshed_at || account.created_at,
          };
        });

        return reply.send({ accounts: formattedAccounts });
      } catch (error) {
        logger.error('Failed to get Claude Code accounts:', error);
        return reply.status(500).send({
          error: 'Failed to get accounts',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Refresh token for a specific account
  fastify.post(
    '/v0/oauth/claude/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email } = request.body as { email?: string };

      if (!email) {
        return reply.status(400).send({ error: 'Missing email parameter' });
      }

      try {
        // Get the credential from database
        const accounts = claudeOAuthService.getAccounts();
        const account = accounts.find(a => a.user_identifier === email);

        if (!account || !account.refresh_token) {
          return reply.status(404).send({ error: 'Account not found' });
        }

        // Refresh the token
        const tokenResponse = await claudeOAuthService.refreshAccessToken(
          account.refresh_token
        );

        // Update the database
        const expiresAtMs = Date.now() + tokenResponse.expires_in * 1000;
        await claudeOAuthService.updateToken(email, tokenResponse.access_token, expiresAtMs);

        logger.info(`Successfully refreshed token for ${email}`);

        return reply.send({
          success: true,
          expires_at: expiresAtMs,
        });
      } catch (error) {
        logger.error(`Failed to refresh token for ${email}:`, error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to refresh token',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Delete OAuth credentials
  fastify.delete(
    '/v0/oauth/claude/:email',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email } = request.params as { email: string };

      if (!email) {
        return reply.status(400).send({ error: 'Missing email parameter' });
      }

      try {
        await claudeOAuthService.deleteCredentials(email);
        logger.info(`Deleted Claude Code credentials for ${email}`);

        return reply.send({ success: true });
      } catch (error) {
        logger.error(`Failed to delete credentials for ${email}:`, error);
        return reply.status(500).send({
          success: false,
          error: 'Failed to delete credentials',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  logger.info('Claude Code OAuth routes registered');
}
