import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderConfig } from '../../config';

const mockScheduler = vi.hoisted(() => ({
  getCheckerIds: vi.fn(() => []),
  isInitialized: vi.fn(() => true),
  reload: vi.fn(() => Promise.resolve()),
}));

vi.mock('../quota/quota-scheduler', () => ({
  QuotaScheduler: {
    getInstance: vi.fn(() => mockScheduler),
  },
}));

import { ConfigService } from '../config-service';

function createMockRepo() {
  return {
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    saveAlias: vi.fn(),
    deleteAlias: vi.fn(),
    deleteAllAliases: vi.fn(() => Promise.resolve(0)),
    saveKey: vi.fn(),
    deleteKey: vi.fn(),
    saveUserQuota: vi.fn(),
    deleteUserQuota: vi.fn(),
    saveMcpServer: vi.fn(),
    deleteMcpServer: vi.fn(),
    setSetting: vi.fn(),
    setSettingsBulk: vi.fn(),
    getAllProviders: vi.fn(() => Promise.resolve({})),
    getAllAliases: vi.fn(() => Promise.resolve({})),
    getAllKeys: vi.fn(() => Promise.resolve({})),
    getAllUserQuotas: vi.fn(() => Promise.resolve({})),
    getAllMcpServers: vi.fn(() => Promise.resolve({})),
    getFailoverPolicy: vi.fn(() => Promise.resolve({ enabled: false })),
    getCooldownPolicy: vi.fn(() => Promise.resolve({ enabled: false })),
    getBackgroundExplorationConfig: vi.fn(() => Promise.resolve({ enabled: false })),
    getTimeoutConfig: vi.fn(() => Promise.resolve({ defaultSeconds: 300 })),
    getStallConfig: vi.fn(() =>
      Promise.resolve({
        ttfbSeconds: null,
        ttfbBytes: 100,
        minBytesPerSecond: null,
        windowSeconds: 10,
        gracePeriodSeconds: 30,
      })
    ),
    getAllSettings: vi.fn(() => Promise.resolve({})),
  };
}

describe('ConfigService write coalescing', () => {
  let service: ConfigService;
  let mockRepo: ReturnType<typeof createMockRepo>;
  let rebuildCount: number;

  beforeEach(() => {
    ConfigService.resetInstance();
    rebuildCount = 0;
    mockRepo = createMockRepo();
    mockScheduler.getCheckerIds.mockReturnValue([]);
    mockScheduler.isInitialized.mockReturnValue(true);
    mockScheduler.reload.mockClear();

    service = new ConfigService(mockRepo as any);

    // Spy on doRebuild to count actual database-level rebuilds
    const original = (service as any).doRebuild.bind(service);
    (service as any).doRebuild = async () => {
      rebuildCount++;
      // Still call original so the cache is populated and flush() works
      await original();
    };
  });

  afterEach(() => {
    ConfigService.resetInstance();
    vi.useRealTimers();
  });

  it('coalesces multiple rapid mutations into a single rebuild', async () => {
    vi.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    await service.saveProvider('p2', {} as any);
    await service.saveAlias('a1', {} as any);

    expect(rebuildCount).toBe(0);

    await vi.advanceTimersByTimeAsync(150);

    expect(rebuildCount).toBe(1);

    vi.useRealTimers();
  });

  it('flush forces immediate rebuild', async () => {
    vi.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    expect(rebuildCount).toBe(0);

    await service.flush();
    expect(rebuildCount).toBe(1);

    vi.useRealTimers();
  });

  it('timer eventually fires and rebuilds after mutations', async () => {
    vi.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    expect(rebuildCount).toBe(0);

    await vi.advanceTimersByTimeAsync(150);
    expect(rebuildCount).toBe(1);

    // A subsequent mutation triggers a new rebuild cycle
    await service.saveAlias('a1', {} as any);
    expect(rebuildCount).toBe(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(rebuildCount).toBe(2);

    vi.useRealTimers();
  });

  it('reloads quota scheduler after first quota checker is saved when scheduler is initialized', async () => {
    vi.useFakeTimers();

    const providerConfig: ProviderConfig = {
      api_base_url: 'https://api.synthetic.new',
      api_key: 'synthetic-key',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      quota_checker: {
        type: 'synthetic',
        enabled: true,
        intervalMinutes: 60,
        options: {},
      },
    };

    await service.saveProvider('synthetic-provider', providerConfig);
    await service.flush();

    expect(mockScheduler.isInitialized).toHaveBeenCalled();
    expect(mockScheduler.reload).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
