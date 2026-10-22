import { fileURLToPath } from 'node:url';

import { type ProviderPreset, ProviderPresetSchema } from '@plexus/shared';
import { z } from 'zod';

import builtinPresetsJson from '../../data/provider-presets.json' with { type: 'json' };
import { logger } from '../utils/logger';

/**
 * Provider preset catalog loader.
 *
 * The catalog defaults to the plexus repo itself (`REMOTE_PRESETS_URL`
 * below), so preset updates ship as a data-file commit with no release. Any
 * failure — unreachable remote, non-200 status, bad JSON, or schema
 * violation — logs a warning and falls back to the built-in local file
 * `packages/backend/data/provider-presets.json`, which doubles as the
 * offline story.
 */

export const REMOTE_PRESETS_URL =
  'https://raw.githubusercontent.com/mcowger/plexus/main/packages/backend/data/provider-presets.json';

const REMOTE_TIMEOUT_MS = 5000;

export interface ProviderPresetsResult {
  presets: ProviderPreset[];
  /** Where the served catalog came from — useful for debugging stale data. */
  source: 'remote' | 'local';
}

export function defaultPresetsPath(): string {
  // src/services/provider-presets.ts -> packages/backend/data/provider-presets.json
  return fileURLToPath(new URL('../../data/provider-presets.json', import.meta.url));
}

export function parseAndValidatePresets(raw: unknown, sourceLabel: string): ProviderPreset[] {
  const entries = Array.isArray(raw) ? raw : (raw as { presets?: unknown } | null)?.presets;
  const parsed = z.array(ProviderPresetSchema).safeParse(entries);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid provider presets from ${sourceLabel}: ${issues}`);
  }
  const seen = new Set<string>();
  for (const preset of parsed.data) {
    if (seen.has(preset.id)) {
      throw new Error(`Duplicate provider preset id '${preset.id}' from ${sourceLabel}`);
    }
    seen.add(preset.id);
  }
  return parsed.data;
}

const PROCESS_STARTED_AT = Date.now();

/** True when the disk file was edited after this process started. Exported for tests. */
export async function diskFileEditedSinceStartup(presetsPath: string): Promise<boolean> {
  const file = Bun.file(presetsPath);
  if (!(await file.exists())) return false;
  const mtime = file.lastModified;
  return Number.isFinite(mtime) && mtime > PROCESS_STARTED_AT;
}

export async function loadLocalPresets(
  presetsPath: string = defaultPresetsPath()
): Promise<ProviderPreset[]> {
  // Prefer the file on disk so hand-edits take effect without a restart.
  // Inside compiled release binaries the data directory is not shipped and
  // import.meta.url resolves to a virtual path, so fall back to the copy the
  // bundler embeds via the static JSON import above.
  if (await Bun.file(presetsPath).exists()) {
    let raw: unknown;
    try {
      raw = await Bun.file(presetsPath).json();
    } catch (error) {
      logger.error(`Provider presets unreadable at ${presetsPath}: ${error}`);
      throw new Error(`Provider presets unreadable at ${presetsPath}`);
    }
    try {
      return parseAndValidatePresets(raw, presetsPath);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  return parseAndValidatePresets(builtinPresetsJson, 'built-in provider-presets.json');
}

async function fetchRemotePresets(url: string): Promise<ProviderPreset[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`remote presets request failed with status ${response.status}`);
  }
  return parseAndValidatePresets(await response.json(), url);
}

export async function loadProviderPresets(
  remoteUrl: string = REMOTE_PRESETS_URL
): Promise<ProviderPresetsResult> {
  // A disk file edited after startup is an operator customization: it wins
  // over the remote catalog so local hand-edits always take effect. A
  // pristine disk file (or a missing one, e.g. inside release binaries)
  // defers to remote, falling back to the embedded copy when unreachable.
  if (await diskFileEditedSinceStartup(defaultPresetsPath())) {
    return { presets: await loadLocalPresets(), source: 'local' };
  }
  try {
    return { presets: await fetchRemotePresets(remoteUrl), source: 'remote' };
  } catch (error) {
    logger.warn(
      `Remote provider presets unavailable (${error instanceof Error ? error.message : error}); serving built-in catalog`
    );
    return { presets: await loadLocalPresets(), source: 'local' };
  }
}
