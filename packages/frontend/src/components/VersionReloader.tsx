import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';
import {
  DEV_VERSION,
  VERSION_POLL_INTERVAL_MS,
  getBundledVersion,
  hasBlockingForm,
  hashText,
  isServerVersionNewer,
  parseHealthzVersion,
} from '../lib/versionCheck';

/** sessionStorage key for the once-per-version reload guard. */
const RELOAD_GUARD_KEY = 'plexus:reloadedForVersion';

/** Dev-mode bundle URL polled for content changes (build ids are all `dev`). */
const DEV_BUNDLE_URL = '/ui/main.js';

interface PendingUpdate {
  /** Identity used for the reload guard and Later-dismissal. */
  key: string;
  /** Human-readable label shown in the banner. */
  label: string;
}

/**
 * Detects a redeployed backend by polling GET /healthz and comparing its
 * `version` against the build id baked into this bundle.
 *
 * - No open form (no dialog, no focused input): reloads immediately, at most
 *   once per server version per tab (a repeat mismatch after a reload shows
 *   the banner instead — covers mixed-replica deploys).
 * - Form actually open: shows a persistent banner with a Refresh button
 *   instead, so unsaved work is never nuked. Once the form closes, the
 *   next poll reloads automatically.
 * - "Later" snoozes that version: neither the banner nor an auto-reload
 *   comes back for it.
 * - Dev mode (`dev` build ids are not comparable): polls the served bundle
 *   content hash instead, so `bun run dev` tabs still reload on rebuild.
 *
 * Only a strictly *newer* server build triggers any of this; see
 * `isServerVersionNewer`. A poll that lands on an older replica is ignored
 * rather than prompting the user to refresh into a downgrade.
 */
export const VersionReloader: React.FC = () => {
  const bundledRef = useRef<string | null>(null);
  const bundleHashRef = useRef<string | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  if (bundledRef.current === null) bundledRef.current = getBundledVersion();

  const handleStale = useCallback((key: string, label: string) => {
    if (dismissedRef.current === key) return;
    let alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === key;
    } catch {
      // Storage unavailable — fall through to the blocking check.
    }
    if (alreadyTried || hasBlockingForm(document)) {
      setUpdate({ key, label });
    } else {
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, key);
      } catch {
        // Storage unavailable — reload anyway; worst case is a repeat poll.
      }
      window.location.reload();
    }
  }, []);

  const checkDevBundle = useCallback(async () => {
    let text: string;
    try {
      const res = await fetch(DEV_BUNDLE_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return;
      text = await res.text();
    } catch {
      return; // Unreachable mid-restart — try again next poll.
    }
    const hash = hashText(text);
    if (bundleHashRef.current === null) {
      bundleHashRef.current = hash; // Baseline — the bundle we loaded with.
      return;
    }
    if (bundleHashRef.current === hash) return;
    bundleHashRef.current = hash;
    handleStale(`dev:${hash}`, 'dev (rebuilt)');
  }, [handleStale]);

  const check = useCallback(async () => {
    let body: unknown;
    try {
      const res = await fetch('/healthz', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      body = await res.json();
    } catch {
      return; // Backend unreachable mid-deploy — try again next poll.
    }
    const bundled = bundledRef.current ?? '';
    const server = parseHealthzVersion(body);
    if (isServerVersionNewer(bundled, server)) {
      handleStale(server ?? '', server ?? '');
      return;
    }
    // Dev build ids carry no information — detect rebuilds by content.
    if (bundled === DEV_VERSION) await checkDevBundle();
  }, [checkDevBundle, handleStale]);

  useEffect(() => {
    const timer = window.setInterval(check, VERSION_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check]);

  if (!update) return null;

  return createPortal(
    <div className="fixed bottom-4 left-1/2 z-[500] w-max max-w-[92vw] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-info/40 bg-bg-surface px-4 py-3 shadow-modal backdrop-blur-md">
        <RefreshCw size={16} className="flex-shrink-0 text-info" />
        <div className="font-body text-xs text-text-secondary">
          A new version (<span className="text-text">{update.label}</span>) is available.
        </div>
        <Button size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            dismissedRef.current = update.key;
            setUpdate(null);
          }}
        >
          Later
        </Button>
      </div>
    </div>,
    document.body
  );
};
