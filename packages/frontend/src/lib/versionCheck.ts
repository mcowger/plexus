/**
 * Helpers for detecting a newly deployed frontend bundle.
 *
 * The backend reports its build id as `version` on `GET /healthz`
 * (see `packages/backend/src/index.ts`); the frontend bakes the same id
 * in as `process.env.APP_VERSION` at build time
 * (see `packages/frontend/build.ts`). The tab should reload only when the
 * server is running a *newer* build — a mere difference is not enough, see
 * `isServerVersionNewer`.
 */

/** How often to poll /healthz for a new build id. */
export const VERSION_POLL_INTERVAL_MS = 60_000;

/**
 * Placeholder build id used when APP_VERSION is unset at build or run time.
 * It means "unknown", never a real build — string-comparing it would reload
 * forever (e.g. release binaries bake in `v1.x` but run without the env var,
 * so /healthz would report `dev` against a `v1.x` bundle on every poll).
 */
export const DEV_VERSION = 'dev';

/** Build id baked into this bundle at build time. */
export const getBundledVersion = (): string => {
  try {
    return process.env.APP_VERSION || 'dev';
  } catch {
    return 'dev';
  }
};

/** Extract the version string from a /healthz body, or null if absent. */
export const parseHealthzVersion = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const version = (body as { version?: unknown }).version;
  return typeof version === 'string' && version.length > 0 ? version : null;
};

/** Build-id formats Plexus has shipped. */
export type VersionKind = 'timestamp' | 'calver' | 'dev-sha';

export interface ParsedVersion {
  kind: VersionKind;
  /** Numeric fields, most-significant first. Empty for `dev-sha`. */
  parts: number[];
}

// Staging deploys: YYYYMMDD-HHMMSS (scripts/deploy-staging.ts).
const TIMESTAMP_RE = /^(\d{8})-(\d{6})$/;
// Release tags: YYYY.MM.DD.N (.github/workflows/release.yml).
const CALVER_RE = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d+)$/;
// Dev pre-releases: dev-<commit sha> (.github/workflows/dev-release.yml).
const DEV_SHA_RE = /^dev-[0-9a-f]{7,40}$/i;

/**
 * Parse a build id into a comparable form, or null when it carries no
 * ordering information (`dev` and anything unrecognized). Ids of different
 * kinds are not comparable against each other.
 */
export const parseVersion = (version: string): ParsedVersion | null => {
  const timestamp = version.match(TIMESTAMP_RE);
  if (timestamp) {
    return { kind: 'timestamp', parts: timestamp.slice(1).map(Number) };
  }
  const calver = version.match(CALVER_RE);
  if (calver) {
    return { kind: 'calver', parts: calver.slice(1).map(Number) };
  }
  if (DEV_SHA_RE.test(version)) {
    return { kind: 'dev-sha', parts: [] };
  }
  return null;
};

/** Element-wise numeric compare, treating missing fields as zero. */
const compareParts = (a: number[], b: number[]): number => {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
};

/**
 * True only when the server is running a strictly newer build than this tab.
 *
 * A plain inequality is not enough: in mixed-replica or load-balanced
 * deploys a poll can land on an older replica, and saying "a new version is
 * available" there is backwards — refreshing would hand the user an older
 * build. The server's id must be newer, not merely different.
 *
 * Ids that cannot be ordered are never treated as newer:
 * - A missing server version, `dev` (unset APP_VERSION), or anything
 *   unrecognized carries no ordering information.
 * - Two different kinds (e.g. a timestamp bundle against a CalVer server
 *   during a format migration) are not comparable.
 *
 * `dev-<sha>` pre-releases are the exception: commit shas cannot be ordered,
 * so any change is treated as the server moving on. Those are single-instance
 * dev builds with no mixed-replica concern.
 */
export const isServerVersionNewer = (bundled: string, server: string | null): boolean => {
  if (!bundled || !server) return false;
  if (bundled === server) return false;
  if (bundled === DEV_VERSION || server === DEV_VERSION) return false;

  const bundledParsed = parseVersion(bundled);
  const serverParsed = parseVersion(server);
  if (!bundledParsed || !serverParsed) return false;
  if (bundledParsed.kind !== serverParsed.kind) return false;
  if (bundledParsed.kind === 'dev-sha') return true;

  return compareParts(serverParsed.parts, bundledParsed.parts) > 0;
};

/**
 * FNV-1a 32-bit hash, hex-encoded. Used for dev-mode bundle change
 * detection (`/ui/main.js`), where every build id is `dev` and the version
 * string alone can never reveal a rebuild.
 */
export const hashText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

/** Minimal DOM surface `hasBlockingForm` needs — keeps unit tests DOM-free. */
export interface BlockingFormDocument {
  querySelector: (selectors: string) => unknown | null;
  activeElement: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Modals, drawers (except the mobile nav drawer), and the toast confirm()
// dialog all render with role="dialog". The nav drawer is excluded by its
// aria-label so an open nav menu doesn't block an auto-reload.
const DIALOG_SELECTOR = '[role="dialog"]:not([aria-label="Main navigation"])';

/**
 * True when reloading right now would risk losing user work:
 * a dialog/modal is open, or keyboard focus is inside an editable field
 * (input, textarea, select, contenteditable, Monaco/playground editors).
 */
export const hasBlockingForm = (doc?: BlockingFormDocument | Document | null): boolean => {
  if (!doc) return false;
  try {
    if (doc.querySelector(DIALOG_SELECTOR)) return true;
    const el = doc.activeElement as { tagName?: string; isContentEditable?: boolean } | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || '').toUpperCase();
    return EDITABLE_TAGS.has(tag);
  } catch {
    return false;
  }
};
