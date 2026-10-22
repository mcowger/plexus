import { clsx } from 'clsx';
import { AlertTriangle, Cpu, Gauge, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { AllowanceMeterRow } from '../components/quota/AllowanceMeterRow';
import { getCheckerDisplayName } from '../components/quota/checker-presentation';
import { CombinedBalancesCard } from '../components/quota/CombinedBalancesCard';
import { MeterHistoryModal } from '../components/quota/MeterHistoryModal';
import { StaleReadingNotice } from '../components/quota/StaleReadingNotice';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { api, fetchQuotaCheckers } from '../lib/api';
import type { Meter, QuotaCheckerInfo } from '../types/quota';

export const Quotas = () => {
  const [quotas, setQuotas] = useState<(QuotaCheckerInfo & { pending?: boolean })[]>([]);
  const [displayNameMap, setDisplayNameMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [historyTarget, setHistoryTarget] = useState<{
    quota: QuotaCheckerInfo;
    meter: Meter;
    displayName: string;
  } | null>(null);

  const fetchQuotas = async () => {
    setLoading(true);
    try {
      const data = await fetchQuotaCheckers();
      setDisplayNameMap(new Map(data.knownTypes.map((t) => [t.type, t.displayName])));
      setQuotas(data.configured);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotas();
    const interval = setInterval(fetchQuotas, 30000);
    return () => clearInterval(interval);
  }, []);

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

  // Failed checks carry no meters by design (the scheduler stores an error
  // sentinel), so route them to their own section — filtering on meters
  // alone would make the whole panel vanish instead of showing the error.
  // Successful-but-empty results (no meters of either kind) land here too,
  // where renderCheckerCard's "No data yet" state covers them.
  const failedQuotas = useMemo(
    () => quotas.filter((q) => !q.pending && (!q.success || q.meters.length === 0)),
    [quotas]
  );

  const balanceQuotas = useMemo(
    () =>
      quotas.filter((q) => q.pending || (q.success && q.meters.some((m) => m.kind === 'balance'))),
    [quotas]
  );

  const allowanceQuotas = useMemo(
    () =>
      quotas.filter(
        (q) => q.pending || (q.success && q.meters.some((m) => m.kind === 'allowance'))
      ),
    [quotas]
  );

  // Group allowance quotas by checkerType for display
  const allowanceGroups = useMemo(() => {
    const groups: Record<string, (QuotaCheckerInfo & { pending?: boolean })[]> = {};
    for (const quota of allowanceQuotas) {
      const key = quota.checkerType || quota.checkerId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(quota);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [allowanceQuotas]);

  const renderCheckerCard = (
    quota: QuotaCheckerInfo & { pending?: boolean },
    _groupDisplayName: string
  ) => {
    const allowances = quota.meters.filter((m) => m.kind === 'allowance');
    const renderCheckerStatus = () => {
      if (quota.pending) {
        return <span className="text-text-muted text-xs">Pending first check...</span>;
      }
      if (!quota.success) {
        return (
          <div className="text-danger flex items-center gap-2">
            <AlertTriangle size={14} />
            <span className="text-xs">Check failed</span>
            {quota.error && <span className="text-text-muted truncate text-xs">{quota.error}</span>}
          </div>
        );
      }

      return (
        <div className="space-y-2">
          {quota.stale && (
            <StaleReadingNotice error={quota.error} hasReading={allowances.length > 0} />
          )}
          {allowances.length === 0 && !quota.stale && (
            <span className="text-text-muted text-xs">No data yet</span>
          )}
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
      );
    };

    return (
      <div
        key={quota.checkerId}
        className="border-border-glass bg-bg-card/60 relative rounded-lg border p-4"
      >
        <button
          type="button"
          onClick={() => handleRefresh(quota.checkerId)}
          disabled={refreshing.has(quota.checkerId) || quota.pending}
          aria-label="Refresh"
          className="text-text-muted hover:bg-bg-hover hover:text-text duration-fast absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={clsx((refreshing.has(quota.checkerId) || quota.pending) && 'animate-spin')}
          />
        </button>

        <div className="pr-8">{renderCheckerStatus()}</div>
      </div>
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Quotas"
        subtitle="Provider balances and rate-quota allowances"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchQuotas}
            disabled={loading}
            leftIcon={<RefreshCw size={14} className={clsx(loading && 'animate-spin')} />}
          >
            Refresh all
          </Button>
        }
      />

      <PageContainer>
        {loading && quotas.length === 0 ? (
          <div className="flex h-64 items-center justify-center gap-3">
            <RefreshCw size={20} className="text-primary animate-spin" />
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
                  displayNameMap={displayNameMap}
                />
              </section>
            )}

            {allowanceGroups.length > 0 && (
              <section>
                <div className="border-border-glass mb-4 flex items-center gap-2 border-b pb-2">
                  <Cpu size={18} className="text-primary" />
                  <h2 className="font-heading text-h2 text-text font-semibold">Rate Limits</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {allowanceGroups.map(([checkerType, quotasList]) => {
                    const displayName = getCheckerDisplayName(
                      checkerType,
                      quotasList[0]?.checkerId ?? checkerType,
                      displayNameMap
                    );
                    return (
                      <div key={checkerType} className="flex flex-col gap-3">
                        <h3 className="font-heading text-text-secondary border-border-glass border-b px-1 pb-2 text-xs font-semibold tracking-wider uppercase">
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

            {failedQuotas.length > 0 && (
              <section>
                <div className="border-border-glass mb-4 flex items-center gap-2 border-b pb-2">
                  <AlertTriangle size={18} className="text-danger" />
                  <h2 className="font-heading text-h2 text-text font-semibold">Needs attention</h2>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {failedQuotas.map((quota) => {
                    const displayName = getCheckerDisplayName(
                      quota.checkerType,
                      quota.checkerId,
                      displayNameMap
                    );
                    return (
                      <div key={quota.checkerId} className="flex flex-col gap-3">
                        <h3 className="font-heading text-text-secondary border-border-glass border-b px-1 pb-2 text-xs font-semibold tracking-wider uppercase">
                          {displayName}
                        </h3>
                        <div className="flex flex-col gap-3">
                          {renderCheckerCard(quota, displayName)}
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
    </div>
  );
};
