import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexVersionService } from '../codex-version-service';

describe('CodexVersionService', () => {
  beforeEach(() => {
    CodexVersionService.resetForTesting();
    vi.restoreAllMocks();
  });

  const mockFetch = (impl: () => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  it('fetches version from GitHub releases API', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ tag_name: 'v0.200.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();

    expect(version).toBe('0.200.0');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/openai/codex/releases/latest',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('strips leading v from tag_name', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ tag_name: 'v1.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('1.0.0');
  });

  it('handles tag without v prefix', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ tag_name: '0.150.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('0.150.0');
  });

  it('falls back to default when fetch fails', async () => {
    mockFetch(async () => {
      throw new Error('network error');
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('0.125.0');
  });

  it('falls back to default when API returns non-200', async () => {
    mockFetch(async () => new Response('rate limited', { status: 403 }));

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('0.125.0');
  });

  it('falls back to default when response has no tag_name', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('0.125.0');
  });

  it('falls back to default when tag format is unexpected', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ tag_name: 'codex-latest' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const version = await service.getVersion();
    expect(version).toBe('0.125.0');
  });

  it('caches the version and does not re-fetch within TTL', async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      return new Response(JSON.stringify({ tag_name: 'v0.200.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const v1 = await service.getVersion();
    const v2 = await service.getVersion();

    expect(v1).toBe('0.200.0');
    expect(v2).toBe('0.200.0');
    expect(callCount).toBe(1);
  });

  it('re-fetches after refresh()', async () => {
    let callCount = 0;
    mockFetch(async () => {
      callCount++;
      return new Response(JSON.stringify({ tag_name: `v0.${200 + callCount}.0` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    const v1 = await service.getVersion();
    const v2 = await service.refresh();

    expect(v1).toBe('0.201.0');
    expect(v2).toBe('0.202.0');
    expect(callCount).toBe(2);
  });

  it('getUserAgent returns correctly formatted string', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ tag_name: 'v0.200.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = CodexVersionService.getInstance();
    await service.getVersion();
    const ua = service.getUserAgent();

    expect(ua).toBe('codex_cli_rs/0.200.0 (Debian 13.0.0; x86_64) WindowsTerminal');
  });

  it('getUserAgent uses default before first fetch', () => {
    const service = CodexVersionService.getInstance();
    const ua = service.getUserAgent();
    expect(ua).toBe('codex_cli_rs/0.125.0 (Debian 13.0.0; x86_64) WindowsTerminal');
  });
});
