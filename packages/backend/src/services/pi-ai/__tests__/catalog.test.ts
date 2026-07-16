import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelsStore, ModelsStoreEntry, MutableModels, Provider } from '@earendil-works/pi-ai';
import {
  createModelCatalog,
  defaultModelsStorePath,
  FileModelsStore,
  REMOTE_CATALOG_REFRESH_INTERVAL_MS,
} from '../catalog';

// pi-ai and logger are globally mocked in test/vitest.setup.ts, with the
// real createProvider re-exported — these tests exercise genuine pi-ai
// overlay semantics against hand-rolled provider/store/fetch fakes.

const BASELINE_MODEL = {
  id: 'claude-base',
  name: 'Baseline',
  provider: 'anthropic',
  api: 'anthropic-messages',
  contextWindow: 200000,
};

function makeProvider(id: string, models: any[]): Provider {
  return {
    id,
    name: id,
    auth: {},
    getModels: () => models,
    stream: () => {
      throw new Error('not used in catalog tests');
    },
    streamSimple: () => {
      throw new Error('not used in catalog tests');
    },
  } as unknown as Provider;
}

function makeModels(...providers: Provider[]): MutableModels {
  const map = new Map(providers.map((p) => [p.id, p]));
  return {
    getProviders: () => [...map.values()],
    getProvider: (id: string) => map.get(id),
    setProvider: (p: Provider) => void map.set(p.id, p),
    deleteProvider: (id: string) => void map.delete(id),
    clearProviders: () => map.clear(),
    getModel: (provider: string, id: string) =>
      map
        .get(provider)
        ?.getModels()
        .find((m: any) => m.id === id),
    getModels: (provider?: string) =>
      provider === undefined
        ? [...map.values()].flatMap((p) => p.getModels())
        : (map.get(provider)?.getModels() ?? []),
  } as unknown as MutableModels;
}

class MapStore implements ModelsStore {
  readonly entries = new Map<string, ModelsStoreEntry>();
  async read(id: string) {
    return this.entries.get(id);
  }
  async write(id: string, entry: ModelsStoreEntry) {
    this.entries.set(id, entry);
  }
  async delete(id: string) {
    this.entries.delete(id);
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

function makeCatalog(overrides: {
  providers?: Provider[];
  store?: MapStore;
  fetchImpl?: any;
  now?: () => number;
}) {
  return createModelCatalog({
    models: makeModels(...(overrides.providers ?? [makeProvider('anthropic', [BASELINE_MODEL])])),
    store: overrides.store ?? new MapStore(),
    fetchImpl: (overrides.fetchImpl ?? vi.fn()) as any,
    now: overrides.now,
  });
}

describe('createModelCatalog', () => {
  it('serves baseline models before any refresh, without network', async () => {
    const fetchImpl = vi.fn();
    const catalog = makeCatalog({ fetchImpl });
    await catalog.init({ allowNetwork: false });

    expect(catalog.getModel('anthropic', 'claude-base')?.id).toBe('claude-base');
    expect(catalog.getModel('anthropic', 'nope')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('merges the remote overlay over the baseline', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        'claude-new': { id: 'claude-new', name: 'New', contextWindow: 500000 },
        'claude-base': { id: 'claude-base', name: 'Baseline v2', contextWindow: 400000 },
      })
    );
    const catalog = makeCatalog({ fetchImpl });
    await catalog.init({ allowNetwork: false });
    const result = await catalog.refresh();

    expect(result.errors).toEqual({});
    expect(catalog.getModel('anthropic', 'claude-new')?.contextWindow).toBe(500000);
    expect(catalog.getModel('anthropic', 'claude-new')?.provider).toBe('anthropic');
    expect(catalog.getModel('anthropic', 'claude-base')?.name).toBe('Baseline v2');
  });

  it('persists the overlay and restores it without network', async () => {
    const store = new MapStore();
    const fetchImpl = vi.fn(async () => jsonResponse({ 'claude-new': { id: 'claude-new' } }));
    await makeCatalog({ store, fetchImpl }).refresh();

    const fetchImpl2 = vi.fn();
    const second = makeCatalog({ store, fetchImpl: fetchImpl2 });
    await second.init({ allowNetwork: false });

    expect(second.getModel('anthropic', 'claude-new')?.id).toBe('claude-new');
    expect(fetchImpl2).not.toHaveBeenCalled();
  });

  it('throttles remote checks to the refresh interval unless forced', async () => {
    // createProvider stamps checkedAt with the real clock, so the fake clock
    // anchors to real time and only advances relative to it.
    let now = Date.now();
    const fetchImpl = vi.fn(async () => jsonResponse({ 'claude-new': { id: 'claude-new' } }));
    const catalog = makeCatalog({ fetchImpl, now: () => now });

    await catalog.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await catalog.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += REMOTE_CATALOG_REFRESH_INTERVAL_MS + 1;
    await catalog.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await catalog.refresh({ force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats 404 as "no overlay" without failing and records the check', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
    const catalog = makeCatalog({ fetchImpl });

    const result = await catalog.refresh();
    expect(result.errors).toEqual({});
    expect(catalog.getModel('anthropic', 'claude-base')?.id).toBe('claude-base');

    await catalog.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retains the stored overlay when the remote fetch fails', async () => {
    const store = new MapStore();
    store.entries.set('anthropic', {
      models: [{ id: 'claude-stored', provider: 'anthropic' } as any],
      checkedAt: 1,
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const catalog = makeCatalog({ store, fetchImpl, now: () => 2_000_000_000 });

    const result = await catalog.refresh();
    expect(result.errors['anthropic']).toContain('network down');
    expect(catalog.getModel('anthropic', 'claude-stored')?.id).toBe('claude-stored');
  });

  it('accepts model-ID keyed, array, and {models:[]} catalog shapes', async () => {
    const bodies: unknown[] = [{ m1: { id: 'm1' } }, [{ id: 'm1' }], { models: [{ id: 'm1' }] }];
    for (const body of bodies) {
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      const catalog = makeCatalog({ providers: [makeProvider('p', [])], fetchImpl });
      await catalog.refresh();
      expect(catalog.getModel('p', 'm1')?.provider).toBe('p');
    }
  });

  it('returns an empty list for unknown providers', () => {
    const catalog = makeCatalog({});
    expect(catalog.getModels('unknown')).toEqual([]);
  });

  it('refreshes in the background when init allows network', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ 'claude-new': { id: 'claude-new' } }));
    const catalog = makeCatalog({ fetchImpl });

    await catalog.init({ allowNetwork: true });
    await vi.waitFor(() =>
      expect(catalog.getModel('anthropic', 'claude-new')?.id).toBe('claude-new')
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    catalog.dispose();
  });

  it('periodically re-refreshes after init and stops on dispose', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ 'claude-new': { id: 'claude-new' } }));
    const catalog = createModelCatalog({
      models: makeModels(makeProvider('anthropic', [BASELINE_MODEL])),
      store: new MapStore(),
      fetchImpl: fetchImpl as any,
      // Always stale, so every interval tick performs a real fetch.
      now: () => Date.now() + REMOTE_CATALOG_REFRESH_INTERVAL_MS,
      refreshIntervalMs: 25,
    });

    await catalog.init({ allowNetwork: true });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2));

    catalog.dispose();
    const callsAtDispose = fetchImpl.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    // A refresh already in flight may complete; no new ones may start.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(callsAtDispose + 1);
  });
});

describe('FileModelsStore', () => {
  it('round-trips entries through the JSON file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'plexus-catalog-'));
    try {
      const file = path.join(dir, 'models-store.json');
      const store = new FileModelsStore(file);
      await store.write('anthropic', { models: [{ id: 'm' } as any], checkedAt: 123 });

      const fresh = new FileModelsStore(file);
      expect(await fresh.read('anthropic')).toEqual({ models: [{ id: 'm' }], checkedAt: 123 });
      expect(await fresh.read('openai')).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('starts empty when the file is corrupt', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'plexus-catalog-'));
    try {
      const file = path.join(dir, 'models-store.json');
      await writeFile(file, 'not json{');
      const store = new FileModelsStore(file);
      expect(await store.read('anthropic')).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recovers the write chain after a failed persist', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'plexus-catalog-'));
    try {
      // Block persistence: the store's parent path is a file, not a directory.
      const blocker = path.join(dir, 'blocked');
      await writeFile(blocker, 'occupied');
      const file = path.join(blocker, 'models-store.json');
      const store = new FileModelsStore(file);

      await expect(
        store.write('anthropic', { models: [{ id: 'm' } as any], checkedAt: 1 })
      ).rejects.toThrow();

      // Unblock: the next write must actually persist, not vanish into a
      // permanently rejected serialization chain.
      await rm(blocker);
      await store.write('anthropic', { models: [{ id: 'm' } as any], checkedAt: 2 });

      const fresh = new FileModelsStore(file);
      expect(await fresh.read('anthropic')).toEqual({ models: [{ id: 'm' }], checkedAt: 2 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('defaultModelsStorePath', () => {
  it('resolves next to the sqlite database file', () => {
    expect(defaultModelsStorePath('sqlite:///data/plexus.db')).toBe(
      path.join('/data', 'models-store.json')
    );
  });

  it('returns undefined for in-memory and non-sqlite databases', () => {
    expect(defaultModelsStorePath('sqlite://:memory:')).toBeUndefined();
    expect(defaultModelsStorePath('postgres://user:pass@host/db')).toBeUndefined();
  });
});
