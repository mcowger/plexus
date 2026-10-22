import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test';

import { setLocation, useHappyDom } from '../../../test/happydom';
import { api, type Provider } from '../api';

useHappyDom();

describe('provider auto-compat persistence', () => {
  beforeEach(() => {
    localStorage.setItem('plexus_admin_key', 'test-admin-key');
    setLocation('http://localhost/ui/providers');
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  it('sends and reloads provider-level auto_compat', async () => {
    const fetchMock = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            test: {
              api_base_url: 'https://api.example.com/v1',
              api_key: 'test-key',
              enabled: true,
              auto_compat: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    const provider: Provider = {
      id: 'test',
      name: 'Test',
      type: ['chat'],
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      enabled: true,
      auto_compat: true,
    };

    await api.saveProvider(provider, 'test');

    const saveRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(saveRequest.body as string)).toMatchObject({ auto_compat: true });

    const [reloadedProvider] = await api.getProviders();
    expect(reloadedProvider?.auto_compat).toBe(true);
  });

  it('sends false when disabling provider boolean settings', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    await api.saveProvider({
      id: 'test',
      name: 'Test',
      type: ['chat'],
      apiBaseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      enabled: true,
      disableCooldown: false,
      stallCooldown: false,
      allow100PercentUtilization: false,
      auto_compat: false,
    });

    const saveRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(saveRequest.body as string)).toMatchObject({
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
      auto_compat: false,
    });
  });

  it('patches only enabled when updating provider status', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    );

    await api.updateProviderEnabled('provider/with-slash', false);

    expect(fetchMock).toHaveBeenCalledWith(
      '/v0/management/providers/provider/with-slash',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      })
    );
  });
});
