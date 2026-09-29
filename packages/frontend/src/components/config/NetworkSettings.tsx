import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, Loader2, Network, RefreshCw, Save, XCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { TagSelect } from '../ui/TagSelect';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import type { CatalogRefreshAllResult, CatalogStatus } from '../../types/aliases';

interface NetworkSettingsProps {
  trustedProxies: string[];
  loaded: boolean;
  saving: boolean;
  onChange: (trustedProxies: string[]) => void;
  onSave: () => void;
}

const REFRESHING_SOURCES = [
  'OpenRouter metadata',
  'models.dev metadata',
  'Catwalk metadata',
  'pi.dev model catalog',
  'Codex CLI version',
  'Claude Code version',
];

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `every ${minutes}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `every ${hours}h` : `every ${minutes}m`;
}

interface ResultRow {
  key: string;
  name: string;
  ok: boolean;
  detail: string;
}

function buildResultRows(result: CatalogRefreshAllResult): ResultRow[] {
  const rows: ResultRow[] = [
    {
      key: 'openrouter',
      name: 'OpenRouter metadata',
      ok: !result.metadata.sources.openrouter.error,
      detail:
        result.metadata.sources.openrouter.error ??
        `${result.metadata.sources.openrouter.count.toLocaleString()} models`,
    },
    {
      key: 'modelsdev',
      name: 'models.dev metadata',
      ok: !result.metadata.sources.modelsDev.error,
      detail:
        result.metadata.sources.modelsDev.error ??
        `${result.metadata.sources.modelsDev.count.toLocaleString()} models`,
    },
    {
      key: 'catwalk',
      name: 'Catwalk metadata',
      ok: !result.metadata.sources.catwalk.error,
      detail:
        result.metadata.sources.catwalk.error ??
        `${result.metadata.sources.catwalk.count.toLocaleString()} models`,
    },
  ];

  const piErrors = Object.entries(result.piCatalog.errors);
  rows.push({
    key: 'pidev',
    name: 'pi.dev model catalog',
    ok: piErrors.length === 0,
    detail:
      piErrors.length === 0
        ? `${result.piCatalog.refreshed} providers refreshed`
        : `${result.piCatalog.refreshed} refreshed, ${piErrors.length} failed: ${piErrors
            .slice(0, 3)
            .map(([id, message]) => `${id} (${message})`)
            .join('; ')}${piErrors.length > 3 ? '…' : ''}`,
  });

  const versionRow = (
    key: string,
    name: string,
    version: { previous: string; current: string; error?: string }
  ): ResultRow => ({
    key,
    name,
    ok: !version.error,
    detail:
      version.error ??
      (version.previous === version.current
        ? `v${version.current} (unchanged)`
        : `v${version.previous} → v${version.current}`),
  });
  rows.push(versionRow('codex', 'Codex CLI version', result.versions.codex));
  rows.push(versionRow('claudecode', 'Claude Code version', result.versions.claudeCode));
  return rows;
}

function ExternalDataRefresh() {
  const toast = useToast();
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<CatalogRefreshAllResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCatalogStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // Status is informational only; the refresh button works regardless.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    setResult(null);
    setError(null);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    try {
      const refreshResult = await api.refreshAllCatalogs();
      setResult(refreshResult);
      if (refreshResult.hadErrors) {
        toast.warning(refreshResult.message);
      } else {
        toast.success(refreshResult.message);
      }
      // Refresh the status snapshot (versions may have moved).
      api
        .getCatalogStatus()
        .then(setStatus)
        .catch(() => undefined);
    } catch (e) {
      const message = (e as Error).message || 'Failed to refresh external data';
      setError(message);
      toast.error(message, 'Refresh failed');
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRefreshing(false);
    }
  };

  const resultRows = result ? buildResultRows(result) : [];

  return (
    <div className="border-t border-border-glass mt-2 pt-3">
      <div className="flex items-center gap-2">
        <Database size={16} className="text-primary" />
        <div className="flex-1">
          <p className="font-body text-[12px] font-medium text-text">External Data Refresh</p>
          <p className="font-body text-[11px] text-text-muted">
            Force an immediate reload of every interval-fetched resource — OpenRouter, models.dev,
            and Catwalk metadata
            {status ? ` (${formatInterval(status.intervals.metadataMinutes)} auto-refresh)` : ''},
            the pi.dev model catalog
            {status
              ? ` (${formatInterval(status.intervals.piCatalogMs / 60000)} auto-refresh)`
              : ''}
            , and the Codex / Claude Code CLI versions
            {status ? ` (${formatInterval(status.intervals.versionMinutes)} auto-refresh)` : ''}.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          isLoading={refreshing}
          leftIcon={<RefreshCw size={14} />}
        >
          Refresh All Data
        </Button>
      </div>

      {refreshing && (
        <div className="mt-3 rounded-md border border-border-2 bg-bg-hover/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-primary shrink-0" />
            <span className="font-body text-[12px] font-medium text-text">
              Refreshing external data… {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {REFRESHING_SOURCES.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-text-muted shrink-0" />
                <span className="font-body text-[11px] text-text-muted">{name} — fetching…</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!refreshing && error && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2">
          <XCircle size={14} className="text-danger shrink-0" />
          <span className="font-body text-[12px] text-text">{error}</span>
        </div>
      )}

      {!refreshing && result && (
        <div className="mt-3 rounded-md border border-border-2 bg-bg-hover/50 px-3 py-2">
          <div className="flex items-center gap-2">
            {result.hadErrors ? (
              <XCircle size={14} className="text-secondary shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="text-success shrink-0" />
            )}
            <span className="font-body text-[12px] font-medium text-text">
              {result.message} in {formatDuration(result.durationMs)} —{' '}
              {new Date(result.refreshedAt).toLocaleString()}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {resultRows.map((row) => (
              <li key={row.key} className="flex items-start gap-2">
                {row.ok ? (
                  <CheckCircle2 size={12} className="text-success shrink-0 mt-[2px]" />
                ) : (
                  <XCircle size={12} className="text-danger shrink-0 mt-[2px]" />
                )}
                <span className="font-body text-[11px] text-text-muted">
                  <span className="font-medium text-text">{row.name}:</span> {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function NetworkSettings({
  trustedProxies,
  loaded,
  saving,
  onChange,
  onSave,
}: NetworkSettingsProps) {
  return (
    <Disclosure
      title="Network Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-primary" />
          <div>
            <p className="font-body text-[12px] font-medium text-text">Trusted Proxies</p>
            <p className="font-body text-[11px] text-text-muted">
              IPs/CIDRs of reverse proxies whose forwarding headers (X-Forwarded-For,
              CF-Connecting-IP, …) are believed when resolving a client&apos;s IP. Requests arriving
              directly from any other address use their real connection IP instead, so spoofed
              headers cannot defeat per-key IP allowlists.
            </p>
          </div>
        </div>

        <div>
          <TagSelect
            label="Trusted Proxy IPs"
            placeholder="e.g. 10.0.0.0/8  172.16.0.0/12  192.168.1.5"
            options={[]}
            selected={trustedProxies}
            allowCustom
            splitOnSpace
            onChange={onChange}
          />
          <p className="text-xs text-text-muted mt-2">
            Type entries separated by spaces. The default trust-all list is <code>0.0.0.0/0</code>{' '}
            plus <code>::/0</code> — keep this only if Plexus is not publicly reachable except
            through your proxy. An empty list trusts no proxies. Accepts IPv4/IPv6, CIDR, and
            ranges.
          </p>
        </div>

        <ExternalDataRefresh />
      </div>
    </Disclosure>
  );
}
