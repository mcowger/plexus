import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Cpu, Gauge, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import type { QuotaCheckerInfo } from '../types/quota';
import { CombinedBalancesCard } from '../components/quota/CombinedBalancesCard';
import { AllowanceMeterRow } from '../components/quota/AllowanceMeterRow';
import { getCheckerDisplayName } from '../components/quota/checker-presentation';

export const Quotas = () => {
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

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
                <AllowanceMeterRow key={meter.key} meter={meter} />
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
    </PageContainer>
  );
};
