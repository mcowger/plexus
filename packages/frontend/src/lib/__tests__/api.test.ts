import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Provider } from '../api';

describe('provider auto-compat persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends and reloads provider-level auto_compat', async () => {
    const fetchMock = vi
      .fn()
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
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'test-admin-key') });
    vi.stubGlobal('window', { location: { pathname: '/ui/providers' } });

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
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'test-admin-key') });
    vi.stubGlobal('window', { location: { pathname: '/ui/providers' } });

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
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'test-admin-key') });
    vi.stubGlobal('window', { location: { pathname: '/ui/providers' } });

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
