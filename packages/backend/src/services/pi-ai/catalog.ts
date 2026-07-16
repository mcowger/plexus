/**
 * Dynamic pi-ai model catalog.
 *
 * pi-ai ships a static, compile-time catalog, so historically every newly
 * released model required a pi-ai version bump. pi.dev serves per-provider
 * catalog overlays built from the same source, and pi-ai's createProvider()
 * owns the overlay machinery (baseline+overlay merge, store restore/persist,
 * inflight dedup). This module supplies the two things pi-ai does not:
 *
 *  - fetchPiDevCatalog: the pi.dev protocol client (URL, user agent,
 *    response parsing, 404/501 handling).
 *  - scheduling: refresh always restores the persisted overlay first, then
 *    only hits the network when the stored check is older than 4h (or
 *    forced). Overlays persist to <db dir>/models-store.json so restarts
 *    and offline boots keep the last-known catalog.
 *
 * After initModelCatalog() runs at startup, getCatalogModel/getCatalogModels
 * resolve models released between pi-ai versions at runtime. The pi.dev
 * endpoint is unauthenticated, so refresh calls provider.refreshModels()
 * directly rather than pi-ai's credential-gated Models.refresh().
 */

import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createProvider } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type {
  Api,
  Model,
  ModelsStore,
  ModelsStoreEntry,
  MutableModels,
  Provider,
  ProviderModelsStore,
  ProviderStreams,
} from '@earendil-works/pi-ai';
import { logger } from '../../utils/logger';

const DEFAULT_CATALOG_BASE_URL = 'https://pi.dev';
const CATALOG_USER_AGENT = 'plexus-gateway';

/** Matches pi's own throttle for configured-provider catalog checks. */
export const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Providers that manage their own catalog lifecycle (e.g. Radius gateways). */
const SELF_REFRESHING_PROVIDERS = new Set(['radius']);

// ─── pi.dev protocol client ─────────────────────────────────────────────────

/** pi.dev answers model-ID keyed objects; tolerate array/{models:[]} shapes too. */
function parseCatalog(providerId: string, value: unknown): Model<Api>[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        'models' in value &&
        Array.isArray(value.models)
      ? value.models
      : typeof value === 'object' && value !== null
        ? Object.values(value)
        : undefined;
  if (!entries) throw new Error(`Invalid model catalog for provider "${providerId}"`);
  return entries
    .filter(
      (entry): entry is Model<Api> => typeof entry === 'object' && entry !== null && 'id' in entry
    )
    .map((model) => ({ ...model, provider: providerId }));
}

/**
 * Fetch a provider's catalog overlay from pi.dev. 404/501 means no overlay is
 * published for the provider — keep whatever the store already holds.
 */
async function fetchPiDevCatalog(
  providerId: string,
  options: {
    store: ProviderModelsStore;
    signal?: AbortSignal;
    catalogBaseUrl?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<readonly Model<Api>[]> {
  const catalogBaseUrl = options.catalogBaseUrl ?? DEFAULT_CATALOG_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = new URL(`/api/models/providers/${encodeURIComponent(providerId)}`, catalogBaseUrl);
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'User-Agent': CATALOG_USER_AGENT },
    signal: options.signal,
  });
  if (response.status === 404 || response.status === 501) {
    const stored = await options.store.read();
    return stored?.models ?? [];
  }
  if (!response.ok) {
    throw new Error(`Model catalog request failed for ${providerId}: ${response.status}`);
  }
  return parseCatalog(providerId, await response.json());
}

/**
 * Rebuild a static built-in provider through pi-ai's createProvider() with a
 * pi.dev fetchModels overlay. Streams delegate to the original provider, so
 * dispatch behaviour is identical to the built-in catalog.
 */
export function withRemoteCatalog(
  provider: Provider,
  options: { catalogBaseUrl?: string; fetchImpl?: typeof fetch } = {}
): Provider {
  const streams: ProviderStreams = {
    stream: provider.stream as unknown as ProviderStreams['stream'],
    streamSimple: provider.streamSimple as unknown as ProviderStreams['streamSimple'],
  };
  return createProvider({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    auth: provider.auth,
    models: provider.getModels(),
    filterModels: provider.filterModels,
    fetchModels: (context) =>
      fetchPiDevCatalog(provider.id, { ...options, store: context.store, signal: context.signal }),
    api: streams,
  }) as Provider;
}

// ─── Stores ─────────────────────────────────────────────────────────────────

/** In-memory ModelsStore (fallback when no persistent path is resolvable). */
export class MemoryModelsStore implements ModelsStore {
  private readonly entries = new Map<string, ModelsStoreEntry>();

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    const entry = this.entries.get(providerId);
    return entry ? structuredClone(entry) : undefined;
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    this.entries.set(providerId, structuredClone(entry));
  }

  async delete(providerId: string): Promise<void> {
    this.entries.delete(providerId);
  }
}

/**
 * File-backed ModelsStore: one JSON object keyed by provider ID. Writes are
 * atomic (tmp + rename) and serialized so concurrent provider refreshes
 * cannot interleave.
 */
export class FileModelsStore implements ModelsStore {
  private entries: Record<string, ModelsStoreEntry> | undefined;
  private loading: Promise<Record<string, ModelsStoreEntry>> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    const entry = (await this.load())[providerId];
    return entry ? structuredClone(entry) : undefined;
  }

  async write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    (await this.load())[providerId] = entry;
    await this.persist();
  }

  async delete(providerId: string): Promise<void> {
    delete (await this.load())[providerId];
    await this.persist();
  }

  private load(): Promise<Record<string, ModelsStoreEntry>> {
    this.loading ??= (async () => {
      try {
        const file = Bun.file(this.filePath);
        this.entries = (await file.exists())
          ? ((await file.json()) as Record<string, ModelsStoreEntry>)
          : {};
      } catch (error) {
        logger.warn(`Model catalog store unreadable, starting empty: ${error}`);
        this.entries = {};
      }
      return this.entries!;
    })();
    return this.loading;
  }

  private persist(): Promise<void> {
    // Recover the chain from a previous rejection: without the catch, one
    // transient failure would leave this.writing rejected and every later
    // write/delete would silently skip its persistence callback. Each caller
    // still receives their own rejection via the returned promise.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await Bun.write(tmp, JSON.stringify(this.entries));
        await rename(tmp, this.filePath);
      });
    return this.writing;
  }
}

/**
 * Default store location: models-store.json next to the SQLite database.
 * Returns undefined for postgres / in-memory databases (caller falls back to
 * the in-memory store). Path resolution mirrors db/client.ts resolvePath.
 */
export function defaultModelsStorePath(
  databaseUrl: string | undefined = process.env.DATABASE_URL
): string | undefined {
  if (!databaseUrl?.startsWith('sqlite://')) return undefined;
  const connStr = databaseUrl.replace('sqlite://', '');
  if (
    connStr === ':memory:' ||
    connStr === 'memory:' ||
    connStr === ':memory:/' ||
    connStr === 'memory:/'
  ) {
    return undefined;
  }
  const dbPath = path.isAbsolute(connStr)
    ? connStr
    : connStr.startsWith('./')
      ? path.resolve(process.cwd(), connStr)
      : path.join(path.resolve(process.cwd(), '../../'), connStr);
  return path.join(path.dirname(dbPath), 'models-store.json');
}

// ─── Catalog ────────────────────────────────────────────────────────────────

export interface ModelCatalogDeps {
  models: MutableModels;
  store: ModelsStore;
  fetchImpl?: typeof fetch;
  catalogBaseUrl?: string;
  now?: () => number;
  /** Periodic re-refresh cadence. Defaults to the 4h throttle interval. */
  refreshIntervalMs?: number;
}

export interface CatalogRefreshResult {
  /** Providers whose refreshModels completed (cache restore counts). */
  refreshed: number;
  /** Per-provider error messages for failed refreshes. */
  errors: Record<string, string>;
}

export interface ModelCatalog {
  /**
   * Wrap static providers with the remote overlay and restore the persisted
   * catalog from the store. When allowNetwork is not false, also kicks off a
   * background pi.dev refresh and schedules periodic re-refreshes (errors
   * are logged, never thrown).
   */
  init(options?: { allowNetwork?: boolean }): Promise<void>;
  /** Stop the periodic re-refresh scheduled by init. */
  dispose(): void;
  /**
   * Restore every provider's persisted overlay, then fetch stale providers
   * from pi.dev (throttled to REMOTE_CATALOG_REFRESH_INTERVAL_MS unless
   * forced).
   */
  refresh(options?: {
    force?: boolean;
    allowNetwork?: boolean;
    signal?: AbortSignal;
  }): Promise<CatalogRefreshResult>;
  /** Sync read of the merged catalog. Returns null for unknown pairs. */
  getModel(provider: string, id: string): Model<Api> | null;
  /** Sync read of the merged catalog, one provider or all. */
  getModels(provider?: string): readonly Model<Api>[];
}

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const { models, store } = deps;
  const now = deps.now ?? Date.now;
  let wrapped = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  function wrapProviders(): void {
    if (wrapped) return;
    wrapped = true;
    for (const provider of models.getProviders()) {
      if (SELF_REFRESHING_PROVIDERS.has(provider.id)) continue;
      // createProvider() only exposes refreshModels when the provider was
      // built with its own fetchModels — i.e. it already has a dynamic
      // catalog source. Wrapping it would silently replace its native
      // refresh with ours, so leave already-dynamic providers alone.
      if (typeof provider.refreshModels === 'function') continue;
      if (typeof provider.getModels !== 'function') continue;
      models.setProvider(withRemoteCatalog(provider, deps));
    }
  }

  async function refresh(
    options: { force?: boolean; allowNetwork?: boolean; signal?: AbortSignal } = {}
  ): Promise<CatalogRefreshResult> {
    wrapProviders();
    const allowNetwork = options.allowNetwork ?? true;
    const errors: Record<string, string> = {};
    let refreshed = 0;
    await Promise.all(
      models.getProviders().map(async (provider) => {
        // Self-refreshing providers manage their own catalog lifecycle
        // (own store, own cadence) — don't drive their refresh here.
        if (SELF_REFRESHING_PROVIDERS.has(provider.id)) return;
        if (typeof provider.refreshModels !== 'function') return;
        const scoped: ProviderModelsStore = {
          read: () => store.read(provider.id),
          write: (entry) => store.write(provider.id, entry),
          delete: () => store.delete(provider.id),
        };
        try {
          // Always restore the persisted overlay first.
          await provider.refreshModels({
            store: scoped,
            allowNetwork: false,
            signal: options.signal,
          });
          if (allowNetwork && !options.signal?.aborted) {
            const stored = await store.read(provider.id);
            const stale =
              options.force === true ||
              stored?.checkedAt === undefined ||
              now() - stored.checkedAt >= REMOTE_CATALOG_REFRESH_INTERVAL_MS;
            if (stale) {
              await provider.refreshModels({
                store: scoped,
                allowNetwork: true,
                force: options.force,
                signal: options.signal,
              });
            }
          }
          refreshed++;
        } catch (error) {
          errors[provider.id] = error instanceof Error ? error.message : String(error);
        }
      })
    );
    return { refreshed, errors };
  }

  function logRefreshOutcome(promise: Promise<CatalogRefreshResult>): void {
    void promise
      .then((result) => {
        const errorCount = Object.keys(result.errors).length;
        if (errorCount > 0) {
          logger.warn(
            `Model catalog refresh completed with ${errorCount} provider error(s): ` +
              Object.entries(result.errors)
                .map(([id, message]) => `${id}: ${message}`)
                .join('; ')
          );
        } else {
          logger.debug(`Model catalog refresh completed (${result.refreshed} providers)`);
        }
      })
      .catch((error) => logger.warn(`Model catalog refresh failed: ${error}`));
  }

  return {
    async init(options: { allowNetwork?: boolean } = {}) {
      wrapProviders();
      // Restore the persisted overlay before serving reads (no network).
      await refresh({ allowNetwork: false });
      if (options.allowNetwork ?? true) {
        logRefreshOutcome(refresh());
        // Long-running instances re-check pi.dev on the throttle cadence;
        // models published after startup would otherwise need a restart.
        refreshTimer ??= setInterval(
          () => logRefreshOutcome(refresh()),
          deps.refreshIntervalMs ?? REMOTE_CATALOG_REFRESH_INTERVAL_MS
        );
        refreshTimer.unref?.();
      }
    },
    dispose(): void {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
    },
    refresh,
    getModel(provider: string, id: string): Model<Api> | null {
      try {
        return models.getModel(provider, id) ?? null;
      } catch {
        return null;
      }
    },
    getModels(provider?: string): readonly Model<Api>[] {
      try {
        return models.getModels(provider);
      } catch {
        return [];
      }
    },
  };
}

// ─── Singleton + module-level API ───────────────────────────────────────────

let singleton: ModelCatalog | undefined;

export function getModelCatalog(): ModelCatalog {
  singleton ??= createModelCatalog({
    models: builtinModels(),
    store: createDefaultStore(),
  });
  return singleton;
}

export function resetModelCatalogForTesting(): void {
  singleton?.dispose();
  singleton = undefined;
}

function createDefaultStore(): ModelsStore {
  const storePath = defaultModelsStorePath();
  return storePath ? new FileModelsStore(storePath) : new MemoryModelsStore();
}

/** Catalog-aware replacement for pi-ai's static getBuiltinModel. */
export function getCatalogModel(provider: string, modelId: string): Model<Api> | null {
  return getModelCatalog().getModel(provider, modelId);
}

/** Catalog-aware replacement for pi-ai's static getBuiltinModels. */
export function getCatalogModels(provider?: string): readonly Model<Api>[] {
  return getModelCatalog().getModels(provider);
}

/**
 * Startup hook: restore the persisted overlay, then refresh from pi.dev in
 * the background. Set PLEXUS_MODEL_CATALOG_REFRESH=false to disable the
 * network refresh (the persisted overlay still loads).
 */
export async function initModelCatalog(options: { allowNetwork?: boolean } = {}): Promise<void> {
  const allowNetwork = options.allowNetwork ?? process.env.PLEXUS_MODEL_CATALOG_REFRESH !== 'false';
  await getModelCatalog().init({ allowNetwork });
}
