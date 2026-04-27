import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Cpu, Gauge, AlertTriangle, DatabaseZap, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import type { QuotaCheckerInfo, Meter } from '../types/quota';
import { CombinedBalancesCard } from '../components/quota/CombinedBalancesCard';
import { AllowanceMeterRow } from '../components/quota/AllowanceMeterRow';
import { MeterHistoryModal } from '../components/quota/MeterHistoryModal';
import { getCheckerDisplayName } from '../components/quota/checker-presentation';

export const Quotas = () => {
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [legacyRowCount, setLegacyRowCount] = useState<number | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{
    inserted: number;
    skipped: number;
    totalSource: number;
  } | null>(null);
  const [truncating, setTruncating] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [downloading, setDownloading] = useState<'csv' | 'sql' | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{
    quota: QuotaCheckerInfo;
    meter: Meter;
    displayName: string;
  } | null>(null);

  const fetchQuotas = async () => {
    setLoading(true);
    const data = await api.getQuotas();
    setQuotas(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchQuotas();
    const interval = setInterval(fetchQuotas, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    api.getLegacySnapshotStatus().then((status) => {
      if (status?.tableExists && status.rowCount > 0) {
        setLegacyRowCount(status.rowCount);
      }
    });
  }, []);

  const handleMigrate = async () => {
    setMigrating(true);
    const result = await api.migrateLegacySnapshots();
    setMigrating(false);
    if (result) {
      setMigrationResult(result);
      setLegacyRowCount(null);
      fetchQuotas();
    }
  };

  const handleTruncate = async () => {
    if (!confirm('Truncate quota_snapshots? This cannot be undone.')) return;
    setTruncating(true);
    const ok = await api.truncateLegacySnapshots();
    setTruncating(false);
    if (ok) setTruncated(true);
  };

  const handleDownloadBackup = async (format: 'csv' | 'sql') => {
    setDownloading(format);
    try {
      await api.downloadLegacySnapshotsBackup(format);
    } catch (e) {
      console.error('Backup download failed', e);
    } finally {
      setDownloading(null);
    }
  };

  const handleRefresh = async (checkerId: string) => {
    setRefreshing((prev) => new Set(prev).add(checkerId));
    await api.triggerQuotaCheck(checkerId);
    await fetchQuotas();
    setRefreshing((prev) => {
      const next = new Set(prev);
      next.delete(checkerId);
      return next;
    });
  };

  const balanceQuotas = useMemo(
    () => quotas.filter((q) => q.meters.some((m) => m.kind === 'balance')),
    [quotas]
  );

  const allowanceQuotas = useMemo(
    () => quotas.filter((q) => q.meters.some((m) => m.kind === 'allowance')),
    [quotas]
  );

  // Group allowance quotas by checkerType for display
  const allowanceGroups = useMemo(() => {
    const groups: Record<string, QuotaCheckerInfo[]> = {};
    for (const quota of allowanceQuotas) {
      const key = quota.checkerType || quota.checkerId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(quota);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [allowanceQuotas]);

  const renderCheckerCard = (quota: QuotaCheckerInfo, _groupDisplayName: string) => {
    const allowances = quota.meters.filter((m) => m.kind === 'allowance');

    return (
      <div
        key={quota.checkerId}
        className="relative rounded-lg border border-border-glass bg-bg-card/60 p-4"
      >
        <button
          type="button"
          onClick={() => handleRefresh(quota.checkerId)}
          disabled={refreshing.has(quota.checkerId)}
          aria-label="Refresh"
          className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text transition-colors duration-fast disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={clsx(refreshing.has(quota.checkerId) && 'animate-spin')}
          />
        </button>

        <div className="pr-8">
          {!quota.success ? (
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle size={14} />
              <span className="text-xs">Check failed</span>
              {quota.error && (
                <span className="text-xs text-text-muted truncate">{quota.error}</span>
              )}
            </div>
          ) : allowances.length === 0 ? (
            <span className="text-xs text-text-muted">No data yet</span>
          ) : (
            <div className="space-y-2">
              {allowances.map((meter) => (
                <AllowanceMeterRow
                  key={meter.key}
                  meter={meter}
                  onClick={() =>
                    setHistoryTarget({
                      quota,
                      meter,
                      displayName: _groupDisplayName,
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="Quota Trackers"
        subtitle="Monitor provider quotas and rate limits."
        actions={
          <Button
            variant="secondary"
            onClick={fetchQuotas}
            disabled={loading}
            leftIcon={<RefreshCw size={16} className={clsx(loading && 'animate-spin')} />}
          >
            Refresh All
          </Button>
        }
      />

      {legacyRowCount !== null && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <DatabaseZap size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="flex-1">
            <p className="font-medium text-amber-300">
              Legacy quota data detected ({legacyRowCount.toLocaleString()} row
              {legacyRowCount !== 1 ? 's' : ''} in{' '}
              <code className="font-mono">quota_snapshots</code>)
            </p>
            <p className="mt-0.5 text-text-secondary">
              Migrate this historical data into the new meter snapshots table to preserve it.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              isLoading={downloading === 'csv'}
              disabled={downloading !== null}
              onClick={() => handleDownloadBackup('csv')}
              leftIcon={<Download size={13} />}
            >
              CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isLoading={downloading === 'sql'}
              disabled={downloading !== null}
              onClick={() => handleDownloadBackup('sql')}
              leftIcon={<Download size={13} />}
            >
              SQL
            </Button>
            <Button
              size="sm"
              variant="secondary"
              isLoading={migrating}
              onClick={handleMigrate}
              leftIcon={<DatabaseZap size={13} />}
            >
              Migrate now
            </Button>
          </div>
        </div>
      )}

      {migrationResult !== null && (
        <div className="flex items-start gap-3 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
          <DatabaseZap size={16} className="mt-0.5 shrink-0 text-green-400" />
          <div className="flex-1">
            <p className="font-medium text-green-300">
              Migration complete — {migrationResult.inserted.toLocaleString()} row
              {migrationResult.inserted !== 1 ? 's' : ''} inserted
              {migrationResult.skipped > 0
                ? `, ${migrationResult.skipped.toLocaleString()} already existed`
                : ''}
              .
            </p>
            {!truncated && (
              <p className="mt-0.5 text-text-secondary">
                You can now truncate the old <code className="font-mono">quota_snapshots</code>{' '}
                table to free up space.
              </p>
            )}
          </div>
          {truncated ? (
            <span className="text-xs text-text-muted self-center">quota_snapshots truncated</span>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                isLoading={downloading === 'csv'}
                disabled={downloading !== null}
                onClick={() => handleDownloadBackup('csv')}
                leftIcon={<Download size={13} />}
              >
                CSV
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isLoading={downloading === 'sql'}
                disabled={downloading !== null}
                onClick={() => handleDownloadBackup('sql')}
                leftIcon={<Download size={13} />}
              >
                SQL
              </Button>
              <Button size="sm" variant="danger" isLoading={truncating} onClick={handleTruncate}>
                Truncate quota_snapshots
              </Button>
            </div>
          )}
        </div>
      )}

      {loading && quotas.length === 0 ? (
        <div className="flex items-center justify-center h-64 gap-3">
          <RefreshCw size={20} className="animate-spin text-primary" />
          <span className="text-text-secondary">Loading quotas...</span>
        </div>
      ) : quotas.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gauge />}
            title="No quota checkers configured"
            description="Configure quota checkers in your provider settings to monitor usage."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {balanceQuotas.length > 0 && (
            <section>
              <CombinedBalancesCard
                balanceQuotas={balanceQuotas}
                onRefresh={handleRefresh}
                refreshing={refreshing}
              />
            </section>
          )}

          {allowanceGroups.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-glass">
                <Cpu size={18} className="text-primary" />
                <h2 className="font-heading text-h2 font-semibold text-text">Rate Limits</h2>
              </div>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {allowanceGroups.map(([checkerType, quotasList]) => {
                  const displayName = getCheckerDisplayName(
                    checkerType,
                    quotasList[0]?.checkerId ?? checkerType
                  );
                  return (
                    <div key={checkerType} className="flex flex-col gap-3">
                      <h3 className="font-heading text-xs font-semibold text-text-secondary uppercase tracking-wider px-1 border-b border-border-glass pb-2">
                        {displayName}
                      </h3>
                      <div className="flex flex-col gap-3">
                        {quotasList.map((quota) => renderCheckerCard(quota, displayName))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
      {historyTarget && (
        <MeterHistoryModal
          isOpen
          onClose={() => setHistoryTarget(null)}
          quota={historyTarget.quota}
          meter={historyTarget.meter}
          displayName={historyTarget.displayName}
        />
      )}
    </PageContainer>
  );
};
