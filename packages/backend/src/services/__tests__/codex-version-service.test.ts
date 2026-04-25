import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodexVersionService } from '../codex-version-service';

describe('CodexVersionService', () => {
  beforeEach(() => {
    CodexVersionService.resetForTesting();
  });

  it('returns default version before fetch', () => {
    const service = CodexVersionService.getInstance();
    expect(service.getVersion()).toBe('0.125.0');
  });

  it('returns default user-agent before fetch', () => {
    const service = CodexVersionService.getInstance();
    expect(service.getUserAgent()).toBe(
      'codex_cli_rs/0.125.0 (Debian 13.0.0; x86_64) WindowsTerminal'
    );
  });

  it('fetches and stores version from GitHub releases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: 'v0.200.0' }),
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.200.0');
    expect(service.getUserAgent()).toBe(
      'codex_cli_rs/0.200.0 (Debian 13.0.0; x86_64) WindowsTerminal'
    );
  });

  it('strips v prefix from tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: 'v1.2.3' }),
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('1.2.3');
  });

  it('handles tag without v prefix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: '0.150.0' }),
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.150.0');
  });

  it('falls back to default on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.125.0');
  });

  it('falls back to default on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.125.0');
  });

  it('falls back to default when tag_name is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.125.0');
  });

  it('ignores unexpected tag format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tag_name: 'codex-beta' }),
      })
    );

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('0.125.0');
  });

  it('uses correct GitHub API URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: 'v0.200.0' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = CodexVersionService.getInstance();
    await service.fetchVersion();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/openai/codex/releases/latest',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      })
    );
  });
});
