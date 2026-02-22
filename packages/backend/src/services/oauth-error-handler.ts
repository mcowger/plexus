export class OAuthErrorHandler {
  static handleAuthError(error: Error, provider: string): Response {
    if (error.message.includes('Not authenticated')) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              `OAuth provider '${provider}' not authenticated. ` +
              `Please run: npx @mariozechner/pi-ai login ${provider}`,
            type: 'authentication_error',
            code: 'oauth_not_authenticated',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (error.message.includes('expired')) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              `OAuth authentication expired for '${provider}'. ` +
              `Please re-authenticate: npx @mariozechner/pi-ai login ${provider}`,
            type: 'authentication_error',
            code: 'oauth_token_expired',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          message: error.message,
          type: 'oauth_error',
          code: 'unknown',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
