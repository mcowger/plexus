import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '../../config';
import { registerSpy } from '../../../test/test-utils';
import { ModelAutosyncScheduler } from '../models/model-autosync-scheduler';

const { discoverModelIdsMock } = vi.hoisted(() => ({ discoverModelIdsMock: vi.fn() }));
vi.mock('../providers/provider-model-discovery', () => ({
  discoverProviderModelIds: discoverModelIdsMock,
}));

const makeProvider = (intervalMinutes: number, createAliases = false): ProviderConfig => ({
  api_base_url: 'https://api.example.com/v1',
  api_key: 'sk-test',
  disable_cooldown: false,
  stall_cooldown: false,
  allow_100_percent_utilization: false,
  estimateTokens: false,
  useClaudeMasking: false,
  model_autosync: { enabled: true, intervalMinutes, createAliases },
});

// Register a provider config directly so runSyncNow can be exercised without
// initialize() firing its own fire-and-forget sync (which would race).
function registerConfig(
  scheduler: ModelAutosyncScheduler,
  providerId: string,
  provider: ProviderConfig
): void {
  const configs = Reflect.get(scheduler, 'configs') as Map<string, unknown>;
  configs.set(providerId, { providerId, provider, intervalMinutes: 60 });
}

describe('ModelAutosyncScheduler', () => {
  afterEach(() => {
    ModelAutosyncScheduler.getInstance().stop();
    ModelAutosyncScheduler.resetInstance();
    discoverModelIdsMock.mockReset();
    vi.useRealTimers();
  });

  it('keeps provider configs cached when scheduling autosync', () => {
    vi.useFakeTimers();

    const scheduler = ModelAutosyncScheduler.getInstance();
    const runSyncNow = registerSpy(scheduler, 'runSyncNow').mockResolvedValue(0);

    scheduler.initialize({ wafer: makeProvider(60) });

    const configs = Reflect.get(scheduler, 'configs') as Map<string, unknown>;
    expect(configs.has('wafer')).toBe(true);
    expect(runSyncNow).toHaveBeenCalledWith('wafer');
  });

  it('keeps provider configs cached when rescheduling interval changes', () => {
    vi.useFakeTimers();

    const scheduler = ModelAutosyncScheduler.getInstance();
    const runSyncNow = registerSpy(scheduler, 'runSyncNow').mockResolvedValue(0);

    scheduler.initialize({ wafer: makeProvider(60) });
    runSyncNow.mockClear();

    scheduler.reload({ wafer: makeProvider(1) });

    const configs = Reflect.get(scheduler, 'configs') as Map<
      string,
      { intervalMinutes: number } | undefined
    >;
    expect(configs.get('wafer')?.intervalMinutes).toBe(1);
    expect(runSyncNow).toHaveBeenCalledWith('wafer');
  });

  it('creates a passthrough alias for each new model when createAliases is enabled', async () => {
    const scheduler = ModelAutosyncScheduler.getInstance();
    const repo = Reflect.get(scheduler, 'repo') as Record<string, unknown>;
    registerSpy(repo, 'addMissingProviderModels').mockResolvedValue(2);
    registerSpy(repo, 'getAlias').mockResolvedValue(null);
    const saveAlias = registerSpy(repo, 'saveAlias').mockResolvedValue(undefined);
    discoverModelIdsMock.mockResolvedValue(['gpt-6-astra', 'gpt-6-nova']);

    registerConfig(scheduler, 'p1', makeProvider(60, true));
    await scheduler.runSyncNow('p1');

    expect(saveAlias).toHaveBeenCalledTimes(2);
    expect(saveAlias).toHaveBeenCalledWith('gpt-6-astra', {
      priority: 'api_match',
      sticky_session: true,
      target_groups: [
        {
          name: 'p1',
          selector: 'random',
          targets: [{ provider: 'p1', model: 'gpt-6-astra', enabled: true }],
        },
      ],
    });
    expect(saveAlias).toHaveBeenCalledWith('gpt-6-nova', expect.anything());
  });

  it('never overwrites a model id that already has an alias', async () => {
    const scheduler = ModelAutosyncScheduler.getInstance();
    const repo = Reflect.get(scheduler, 'repo') as Record<string, unknown>;
    registerSpy(repo, 'addMissingProviderModels').mockResolvedValue(0);
    registerSpy(repo, 'getAlias').mockImplementation(async (slug: string) =>
      slug === 'gpt-6-astra' ? { priority: 'selector' } : null
    );
    const saveAlias = registerSpy(repo, 'saveAlias').mockResolvedValue(undefined);
    discoverModelIdsMock.mockResolvedValue(['gpt-6-astra', 'gpt-6-nova']);

    registerConfig(scheduler, 'p1', makeProvider(60, true));
    await scheduler.runSyncNow('p1');

    expect(saveAlias).toHaveBeenCalledTimes(1);
    expect(saveAlias).toHaveBeenCalledWith('gpt-6-nova', expect.anything());
    expect(saveAlias).not.toHaveBeenCalledWith('gpt-6-astra', expect.anything());
  });

  it('does not create aliases when createAliases is disabled', async () => {
    const scheduler = ModelAutosyncScheduler.getInstance();
    const repo = Reflect.get(scheduler, 'repo') as Record<string, unknown>;
    registerSpy(repo, 'addMissingProviderModels').mockResolvedValue(1);
    const getAlias = registerSpy(repo, 'getAlias').mockResolvedValue(null);
    const saveAlias = registerSpy(repo, 'saveAlias').mockResolvedValue(undefined);
    discoverModelIdsMock.mockResolvedValue(['gpt-6-astra']);

    registerConfig(scheduler, 'p1', makeProvider(60, false));
    await scheduler.runSyncNow('p1');

    expect(getAlias).not.toHaveBeenCalled();
    expect(saveAlias).not.toHaveBeenCalled();
  });

  it('fires the models-changed callback when only aliases were created', async () => {
    const scheduler = ModelAutosyncScheduler.getInstance();
    const repo = Reflect.get(scheduler, 'repo') as Record<string, unknown>;
    registerSpy(repo, 'addMissingProviderModels').mockResolvedValue(0);
    registerSpy(repo, 'getAlias').mockResolvedValue(null);
    registerSpy(repo, 'saveAlias').mockResolvedValue(undefined);
    discoverModelIdsMock.mockResolvedValue(['gpt-6-astra']);
    const onModelsChanged = vi.fn();
    Reflect.set(scheduler, 'onModelsChanged', onModelsChanged);

    registerConfig(scheduler, 'p1', makeProvider(60, true));
    await scheduler.runSyncNow('p1');

    expect(onModelsChanged).toHaveBeenCalledTimes(1);
  });
});
