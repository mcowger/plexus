import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeCodeVersionService } from '../claude-code-version-service';
import { CC_VERSION } from '../../../transformers/oauth/masking/cc-constants';

describe('ClaudeCodeVersionService', () => {
  beforeEach(() => {
    ClaudeCodeVersionService.resetForTesting();
  });

  it('returns the CC_VERSION fallback before fetch', () => {
    const service = ClaudeCodeVersionService.getInstance();
    expect(service.getVersion()).toBe(CC_VERSION);
  });

  it('reports the auto-refresh interval', () => {
    const service = ClaudeCodeVersionService.getInstance();
    expect(service.getAutoRefreshIntervalMinutes()).toBe(60);
    service.startAutoRefresh(30);
    expect(service.getAutoRefreshIntervalMinutes()).toBe(30);
    service.stopAutoRefresh();
  });

  it('fetches and stores the latest dist-tag from the npm registry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300', stable: '2.1.280', next: '2.1.300' }),
      })
    );

    const service = ClaudeCodeVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('2.1.300');
  });

  it('prefers the latest tag over stable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.280', stable: '2.1.267' }),
      })
    );

    const service = ClaudeCodeVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe('2.1.280');
  });

  it('falls back to the previous version on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const service = ClaudeCodeVersionService.getInstance();
    const error = await service.fetchVersion();

    expect(service.getVersion()).toBe(CC_VERSION);
    expect(error).toContain('network error');
  });

  it('falls back to the previous version on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      })
    );

    const service = ClaudeCodeVersionService.getInstance();
    const error = await service.fetchVersion();

    expect(service.getVersion()).toBe(CC_VERSION);
    expect(error).toBe('npm registry returned status 403');
  });

  it('falls back to the previous version when latest is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );

    const service = ClaudeCodeVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe(CC_VERSION);
  });

  it('ignores non-semver latest tags', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300-beta.1' }),
      })
    );

    const service = ClaudeCodeVersionService.getInstance();
    await service.fetchVersion();

    expect(service.getVersion()).toBe(CC_VERSION);
  });

  it('keeps the last-known version when a refresh fails', async () => {
    const service = ClaudeCodeVersionService.getInstance();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300' }),
      })
    );
    await service.fetchVersion();
    expect(service.getVersion()).toBe('2.1.300');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    await service.fetchVersion();
    expect(service.getVersion()).toBe('2.1.300');
  });

  it('uses the npm dist-tags URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ latest: '2.1.300' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = ClaudeCodeVersionService.getInstance();
    await service.fetchVersion();

    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/-/package/@anthropic-ai%2Fclaude-code/dist-tags',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      })
    );
  });

  it('startAutoRefresh refetches the version on schedule', async () => {
    vi.useFakeTimers();
    try {
      ClaudeCodeVersionService.resetForTesting();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = ClaudeCodeVersionService.getInstance();
      service.startAutoRefresh(60);
      expect(mockFetch).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(service.getVersion()).toBe('2.1.300');

      service.stopAutoRefresh();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopAutoRefresh cancels scheduled refetches', async () => {
    vi.useFakeTimers();
    try {
      ClaudeCodeVersionService.resetForTesting();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const service = ClaudeCodeVersionService.getInstance();
      service.startAutoRefresh(60);
      service.stopAutoRefresh();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetForTesting stops the auto-refresh timer', async () => {
    vi.useFakeTimers();
    try {
      ClaudeCodeVersionService.resetForTesting();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ latest: '2.1.300' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      ClaudeCodeVersionService.getInstance().startAutoRefresh(60);
      ClaudeCodeVersionService.resetForTesting();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
