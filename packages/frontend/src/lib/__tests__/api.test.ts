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
});
