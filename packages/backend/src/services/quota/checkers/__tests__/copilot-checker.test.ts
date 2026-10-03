import { beforeEach, describe, expect, it } from 'vitest';
import { registerSpy } from '../../../../../test/test-utils';
import { OAuthAuthManager } from '../../../oauth/oauth-auth-manager';
import { createMeterContext } from '../../checker-registry';
import checker from '../copilot-checker';

describe('Copilot enterprise quota', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
  });

  it.each([
    [undefined, 'https://api.github.com/copilot_internal/user'],
    ['invalid domain', 'https://api.github.com/copilot_internal/user'],
    ['work.ghe.com', 'https://api.work.ghe.com/copilot_internal/user'],
    ['https://work.ghe.com/', 'https://api.work.ghe.com/copilot_internal/user'],
  ])('derives the quota endpoint from enterprise domain %s', async (enterpriseUrl, endpoint) => {
    const credentials = registerSpy(
      OAuthAuthManager.getInstance(),
      'getCredentials'
    ).mockReturnValue({
      access: 'copilot-token',
      refresh: 'github-token',
      expires: Date.now() + 60_000,
      enterpriseUrl,
    });
    const fetch = registerSpy(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await checker.check(createMeterContext('work-quota', 'copilot', { oauthAccountId: 'work' }));
    expect(credentials).toHaveBeenCalledWith('github-copilot', 'work');
    expect(fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'token github-token' }),
      })
    );
  });

  it('preserves an explicit endpoint override', async () => {
    registerSpy(OAuthAuthManager.getInstance(), 'getCredentials').mockReturnValue({
      access: 'copilot-token',
      refresh: 'github-token',
      expires: Date.now() + 60_000,
      enterpriseUrl: 'work.ghe.com',
    });
    const fetch = registerSpy(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await checker.check(
      createMeterContext('work-quota', 'copilot', {
        oauthAccountId: 'work',
        endpoint: 'https://quota.example.com/user',
      })
    );
    expect(fetch.mock.calls[0]![0]).toBe('https://quota.example.com/user');
  });
});
