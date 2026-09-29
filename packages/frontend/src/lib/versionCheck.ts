/**
 * Helpers for detecting a newly deployed frontend bundle.
 *
 * The backend reports its build id as `version` on `GET /healthz`
 * (see `packages/backend/src/index.ts`); the frontend bakes the same id
 * in as `process.env.APP_VERSION` at build time
 * (see `packages/frontend/build.ts`). When they differ, the server has
 * been redeployed since this tab loaded.
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

/**
 * True when the server is running a different build than this tab.
 * A null server version means an old backend without the field, and `dev`
 * on either side means the build id is unknown — neither is comparable,
 * so neither is ever treated as stale.
 */
export const isVersionStale = (current: string, server: string | null): boolean => {
  if (!server || !current) return false;
  if (current === server) return false;
  if (current === DEV_VERSION || server === DEV_VERSION) return false;
  return true;
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
