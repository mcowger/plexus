import { afterEach, beforeEach, describe, expect, it, jest, mock, spyOn } from 'bun:test';

import { advanceTimersByTimeAsync } from '../../../test/test-utils';
import type { ProviderConfig } from '../../config';
import { QuotaScheduler } from '../quota/quota-scheduler';

const mockScheduler = {
  getCheckerIds: mock(() => []),
  isInitialized: mock(() => true),
  reload: mock(() => Promise.resolve()),
};

beforeEach(() => {
  spyOn(QuotaScheduler, 'getInstance').mockReturnValue(mockScheduler as any);
});

import { ConfigService } from '../configuration/config-service';

function createMockRepo() {
  return {
    saveProvider: mock(),
    deleteProvider: mock(),
    saveAlias: mock(),
    deleteAlias: mock(),
    deleteAllAliases: mock(() => Promise.resolve(0)),
    saveKey: mock(),
    deleteKey: mock(),
    saveUserQuota: mock(),
    deleteUserQuota: mock(),
    saveMcpServer: mock(),
    deleteMcpServer: mock(),
    setSetting: mock(),
    setSettingsBulk: mock(),
    getAllProviders: mock(() => Promise.resolve({})),
    getAllAliases: mock(() => Promise.resolve({})),
    getAllKeys: mock(() => Promise.resolve({})),
    getAllUserQuotas: mock(() => Promise.resolve({})),
    getAllMcpServers: mock(() => Promise.resolve({})),
    getFailoverPolicy: mock(() => Promise.resolve({ enabled: false })),
    getCooldownPolicy: mock(() => Promise.resolve({ enabled: false })),
    getBackgroundExplorationConfig: mock(() => Promise.resolve({ enabled: false })),
    getMcpOAuthConfig: mock(() => Promise.resolve(undefined)),
    getTimeoutConfig: mock(() => Promise.resolve({ defaultSeconds: 300 })),
    getStallConfig: mock(() =>
      Promise.resolve({
        ttfbSeconds: null,
        ttfbBytes: 100,
        minBytesPerSecond: null,
        windowSeconds: 10,
        gracePeriodSeconds: 30,
      })
    ),
    getAllSettings: mock(() => Promise.resolve({})),
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
    jest.useRealTimers();
  });

  it('coalesces multiple rapid mutations into a single rebuild', async () => {
    jest.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    await service.saveProvider('p2', {} as any);
    await service.saveAlias('a1', {} as any);

    expect(rebuildCount).toBe(0);

    await advanceTimersByTimeAsync(150);
    expect(rebuildCount).toBe(1);

    jest.useRealTimers();
  });

  it('flush forces immediate rebuild', async () => {
    jest.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    expect(rebuildCount).toBe(0);

    await service.flush();
    expect(rebuildCount).toBe(1);

    jest.useRealTimers();
  });

  it('timer eventually fires and rebuilds after mutations', async () => {
    jest.useFakeTimers();

    await service.saveProvider('p1', {} as any);
    expect(rebuildCount).toBe(0);

    await advanceTimersByTimeAsync(150);
    expect(rebuildCount).toBe(1);

    // A subsequent mutation triggers a new rebuild cycle
    await service.saveAlias('a1', {} as any);
    expect(rebuildCount).toBe(1);

    await advanceTimersByTimeAsync(150);
    expect(rebuildCount).toBe(2);

    jest.useRealTimers();
  });

  it('reloads quota scheduler after first quota checker is saved when scheduler is initialized', async () => {
    jest.useFakeTimers();

    const providerConfig: ProviderConfig = {
      api_base_url: 'https://api.synthetic.new',
      api_key: 'synthetic-key',
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
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

    jest.useRealTimers();
  });
});
