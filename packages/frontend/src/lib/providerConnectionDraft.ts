import { isOAuthPlaceholderUrl } from '@plexus/shared';

/**
 * Connection-mode drafts for the provider form.
 *
 * A provider is either URL-based (an `apiBaseUrl` map plus an API key and
 * inferred protocol list) or OAuth-based (`oauth://` placeholder, `oauth`
 * key, and an OAuth provider id). The form edits both through the single
 * `editingProvider` draft, so toggling modes naively overwrites the other
 * mode's data. This module preserves each mode's connection fields — and
 * only those fields — so unrelated draft state (models, quirks, headers,
 * presets) survives a round trip.
 */

export type ConnectionMode = 'url' | 'oauth';

/** Connection fields owned by a single mode. */
export interface ConnectionDraft {
  apiBaseUrl: string | Record<string, string>;
  apiKey: string;
  oauthProvider: string;
  type: string[];
}

export type ConnectionDraftMap = Partial<Record<ConnectionMode, ConnectionDraft>>;

/** Minimal shape the helpers read or copy. Extra provider fields are preserved. */
export interface ConnectionDraftSource {
  apiBaseUrl?: string | Record<string, string>;
  apiKey?: string;
  oauthProvider?: string;
  type?: string | string[];
}

/** Which mode a draft is currently in, derived from its `apiBaseUrl`. */
export function connectionModeOf(source: ConnectionDraftSource): ConnectionMode {
  return typeof source.apiBaseUrl === 'string' && isOAuthPlaceholderUrl(source.apiBaseUrl)
    ? 'oauth'
    : 'url';
}

function cloneApiBaseUrl(
  apiBaseUrl: ConnectionDraftSource['apiBaseUrl']
): string | Record<string, string> {
  if (typeof apiBaseUrl === 'string') return apiBaseUrl;
  if (apiBaseUrl && typeof apiBaseUrl === 'object' && !Array.isArray(apiBaseUrl)) {
    return { ...apiBaseUrl };
  }
  return {};
}

function draftTypes(type: ConnectionDraftSource['type']): string[] {
  if (Array.isArray(type)) return [...type];
  return typeof type === 'string' && type.length > 0 ? [type] : [];
}

/** Snapshot the connection fields of a draft as an independent copy. */
export function captureConnectionDraft(source: ConnectionDraftSource): ConnectionDraft {
  return {
    apiBaseUrl: cloneApiBaseUrl(source.apiBaseUrl),
    apiKey: source.apiKey ?? '',
    oauthProvider: source.oauthProvider ?? '',
    type: draftTypes(source.type),
  };
}

/** A blank URL-mode connection draft. */
export function emptyUrlConnectionDraft(): ConnectionDraft {
  return { apiBaseUrl: {}, apiKey: '', oauthProvider: '', type: [] };
}

/** A fresh OAuth-mode connection draft for the given provider id. */
export function oauthConnectionDraft(oauthProvider: string): ConnectionDraft {
  return { apiBaseUrl: 'oauth://', apiKey: 'oauth', oauthProvider, type: ['oauth'] };
}

/**
 * Apply a connection draft onto a provider draft. Only the four connection
 * fields are written; every other field is carried through untouched.
 */
export function applyConnectionDraft<T extends ConnectionDraftSource>(
  source: T,
  draft: ConnectionDraft
): T {
  return {
    ...source,
    apiBaseUrl: cloneApiBaseUrl(draft.apiBaseUrl),
    apiKey: draft.apiKey,
    oauthProvider: draft.oauthProvider,
    type: [...draft.type],
  };
}

/**
 * Switch a provider draft to `targetMode`, preserving the source mode's
 * connection fields in `drafts` and restoring the target mode's saved draft
 * (or a sensible default) when one exists.
 *
 * `fallbackOAuthProvider` seeds a first-time OAuth draft when the draft has
 * no OAuth provider yet.
 */
export function switchConnectionMode<T extends ConnectionDraftSource>(
  source: T,
  targetMode: ConnectionMode,
  drafts: ConnectionDraftMap,
  fallbackOAuthProvider = ''
): { provider: T; drafts: ConnectionDraftMap } {
  const sourceMode = connectionModeOf(source);
  if (sourceMode === targetMode) {
    return { provider: source, drafts };
  }

  const nextDrafts: ConnectionDraftMap = {
    ...drafts,
    [sourceMode]: captureConnectionDraft(source),
  };
  const targetDraft =
    nextDrafts[targetMode] ??
    (targetMode === 'oauth'
      ? oauthConnectionDraft(source.oauthProvider || fallbackOAuthProvider)
      : emptyUrlConnectionDraft());

  return { provider: applyConnectionDraft(source, targetDraft), drafts: nextDrafts };
}
