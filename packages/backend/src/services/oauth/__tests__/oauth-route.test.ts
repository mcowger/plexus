import { describe, expect, test } from 'bun:test';

import { ProviderConfigSchema } from '../../../config';
import { isNativeOAuthRoute } from '../../dispatch/request-payload-builder';
import type { RouteResult } from '../../routing/router';
import { isClaudeMaskingApiKeyRoute, isOAuthRoute } from '../oauth-dispatcher';

describe('OAuth route classification', () => {
  test.each(['oauth://anthropic', 'OAuth://anthropic', ' OAUTH://anthropic '])(
    'selects native OAuth handling for validated placeholder %j',
    (api_base_url) => {
      const route: RouteResult = {
        provider: 'claude',
        model: 'claude-test',
        config: ProviderConfigSchema.parse({
          api_base_url,
          oauth_provider: 'anthropic',
          oauth_account: 'default',
          useClaudeMasking: true,
        }),
      };

      // The dispatcher resolves OAuth requests to their actual wire format.
      expect(isOAuthRoute(route, 'messages')).toBe(true);
      expect(isNativeOAuthRoute(route, 'messages')).toBe(true);
      expect(isClaudeMaskingApiKeyRoute(route, 'messages')).toBe(false);
    }
  );
});
