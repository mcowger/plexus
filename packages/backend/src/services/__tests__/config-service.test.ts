import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../quota/quota-scheduler', () => ({
  QuotaScheduler: {
    getInstance: vi.fn(() => ({
      getCheckerIds: vi.fn(() => []),
      reload: vi.fn(),
    })),
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
});
