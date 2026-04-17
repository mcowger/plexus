import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Cpu, Gauge } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import type { QuotaCheckerInfo, QuotaCheckResult } from '../types/quota';
import { toBoolean, toIsoString } from '../lib/normalize';
import {
  SyntheticQuotaDisplay,
  ClaudeCodeQuotaDisplay,
  NagaQuotaDisplay,
  OpenAICodexQuotaDisplay,
  NanoGPTQuotaDisplay,
  ZAIQuotaDisplay,
  MoonshotQuotaDisplay,
  MiniMaxQuotaDisplay,
  MiniMaxCodingQuotaDisplay,
  OpenRouterQuotaDisplay,
  KiloQuotaDisplay,
  CopilotQuotaDisplay,
  WisdomGateQuotaDisplay,
  KimiCodeQuotaDisplay,
  PoeQuotaDisplay,
  GeminiCliQuotaDisplay,
  AntigravityQuotaDisplay,
  ApertisCodingPlanQuotaDisplay,
  OllamaQuotaDisplay,
  NeuralwattQuotaDisplay,
  CombinedBalancesCard,
  QuotaHistoryModal,
  BalanceHistoryModal,
} from '../components/quota';

const CHECKER_DISPLAY_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  minimax: 'MiniMax',
  'minimax-coding': 'MiniMax Coding',
  moonshot: 'Moonshot',
  naga: 'Naga',
  kilo: 'Kilo',
  poe: 'POE',
  'openai-codex': 'OpenAI Codex',
  'claude-code': 'Claude Code',
  zai: 'ZAI',
  synthetic: 'Synthetic',
  nanogpt: 'NanoGPT',
  'kimi-code': 'Kimi Code',
  copilot: 'GitHub Copilot',
  wisdomgate: 'Wisdom Gate',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'Antigravity',
  apertis: 'Apertis',
  'apertis-coding-plan': 'Apertis Coding',
  ollama: 'Ollama',
  neuralwatt: 'Neuralwatt',
};

export const Quotas = () => {
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [selectedQuota, setSelectedQuota] = useState<QuotaCheckerInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDisplayName, setSelectedDisplayName] = useState('');
  const [isBalanceModal, setIsBalanceModal] = useState(false);

  const isBalanceChecker = (quota: QuotaCheckerInfo): boolean =>
    quota.checkerCategory === 'balance';

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

  const getQuotaResult = (quota: QuotaCheckerInfo): QuotaCheckResult => {
    if (!quota.latest || quota.latest.length === 0) {
      return {
        provider: 'unknown',
        checkerId: quota.checkerId,
        oauthAccountId: quota.oauthAccountId,
        oauthProvider: quota.oauthProvider,
        checkedAt: new Date().toISOString(),
        success: false,
        error: 'No quota data available yet',
        windows: [],
      };
    }

    const windowsByType = new Map<string, (typeof quota.latest)[0]>();
    for (const snapshot of quota.latest) {
      const key = snapshot.description
        ? `${snapshot.windowType}:${snapshot.description}`
        : snapshot.windowType;
      const existing = windowsByType.get(key);
      if (!existing || snapshot.checkedAt > existing.checkedAt) {
        windowsByType.set(key, snapshot);
      }
    }

    const windows = Array.from(windowsByType.values()).map((snapshot) => ({
      windowType: snapshot.windowType as any,
      windowLabel: snapshot.description || snapshot.windowType,
      limit: snapshot.limit ?? undefined,
      used: snapshot.used ?? undefined,
      remaining: snapshot.remaining ?? undefined,
      utilizationPercent: snapshot.utilizationPercent ?? 0,
      unit: (snapshot.unit as any) || 'percentage',
      resetsAt: toIsoString(snapshot.resetsAt) ?? undefined,
      resetInSeconds:
        snapshot.resetInSeconds !== null && snapshot.resetInSeconds !== undefined
          ? snapshot.resetInSeconds
          : undefined,
      status: (snapshot.status as any) || 'ok',
    }));

    const firstSnapshot = quota.latest[0];
    const errorFromSnapshots =
      quota.latest.find((snapshot) => snapshot.errorMessage)?.errorMessage || undefined;
    return {
      provider: firstSnapshot.provider,
      checkerId: firstSnapshot.checkerId,
      oauthAccountId: quota.oauthAccountId,
      oauthProvider: quota.oauthProvider,
      checkedAt: toIsoString(firstSnapshot.checkedAt) ?? new Date(0).toISOString(),
      success: toBoolean(firstSnapshot.success),
      error: errorFromSnapshots,
      windows,
    };
  };

  const groupedQuotas = useMemo(() => {
    const groups: Record<string, QuotaCheckerInfo[]> = {};
    for (const quota of quotas) {
      const key = quota.checkerType || quota.checkerId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(quota);
    }
    return groups;
  }, [quotas]);

  const BALANCE_CHECKERS_WITH_RATE_LIMIT = new Set(['neuralwatt']);

  const balanceGroups = useMemo(() => {
    return Object.entries(groupedQuotas)
      .filter(([, quotasList]) => quotasList.some((q) => q.checkerCategory === 'balance'))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [groupedQuotas]);

  const rateLimitGroups = useMemo(() => {
    return Object.entries(groupedQuotas)
      .filter(([, quotasList]) =>
        quotasList.some(
          (q) =>
            q.checkerCategory === 'rate-limit' ||
            BALANCE_CHECKERS_WITH_RATE_LIMIT.has(q.checkerType || q.checkerId)
        )
      )
      .sort(([a], [b]) => a.localeCompare(b));
  }, [groupedQuotas]);

  const handleCardClick = (quota: QuotaCheckerInfo, displayName: string) => {
    setSelectedQuota(quota);
    setSelectedDisplayName(displayName);
    setIsBalanceModal(isBalanceChecker(quota));
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedQuota(null);
    setSelectedDisplayName('');
    setIsBalanceModal(false);
  };

  const renderQuotaDisplay = (quota: QuotaCheckerInfo, groupDisplayName: string) => {
    const result = getQuotaResult(quota);
    const checkerType = quota.checkerType || quota.checkerId;

    const wrapper = (children: React.ReactNode) => (
      <div
        key={quota.checkerId}
        onClick={() => handleCardClick(quota, groupDisplayName)}
        className="relative cursor-pointer rounded-lg border border-border-glass bg-bg-card/60 p-4 transition-colors duration-fast hover:border-primary/40"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRefresh(quota.checkerId);
          }}
          disabled={refreshing.has(quota.checkerId)}
          aria-label="Refresh"
          className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text transition-colors duration-fast disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(refreshing.has(quota.checkerId) && 'animate-spin')} />
        </button>
        <div className="pr-8">{children}</div>
      </div>
    );

    const DISPLAY_MAP: Record<string, React.ReactNode> = {
      synthetic: <SyntheticQuotaDisplay result={result} isCollapsed={false} />,
      'claude-code': <ClaudeCodeQuotaDisplay result={result} isCollapsed={false} />,
      naga: <NagaQuotaDisplay result={result} isCollapsed={false} />,
      nanogpt: <NanoGPTQuotaDisplay result={result} isCollapsed={false} />,
      'openai-codex': <OpenAICodexQuotaDisplay result={result} isCollapsed={false} />,
      zai: <ZAIQuotaDisplay result={result} isCollapsed={false} />,
      moonshot: <MoonshotQuotaDisplay result={result} isCollapsed={false} />,
      'minimax-coding': <MiniMaxCodingQuotaDisplay result={result} isCollapsed={false} />,
      minimax: <MiniMaxQuotaDisplay result={result} isCollapsed={false} />,
      openrouter: <OpenRouterQuotaDisplay result={result} isCollapsed={false} />,
      kilo: <KiloQuotaDisplay result={result} isCollapsed={false} />,
      poe: <PoeQuotaDisplay result={result} isCollapsed={false} />,
      copilot: <CopilotQuotaDisplay result={result} isCollapsed={false} />,
      'kimi-code': <KimiCodeQuotaDisplay result={result} isCollapsed={false} />,
      wisdomgate: <WisdomGateQuotaDisplay result={result} isCollapsed={false} />,
      'gemini-cli': <GeminiCliQuotaDisplay result={result} isCollapsed={false} />,
      'apertis-coding-plan': <ApertisCodingPlanQuotaDisplay result={result} isCollapsed={false} />,
      antigravity: <AntigravityQuotaDisplay result={result} isCollapsed={false} />,
      ollama: <OllamaQuotaDisplay result={result} isCollapsed={false} />,
      neuralwatt: <NeuralwattQuotaDisplay result={result} isCollapsed={false} />,
    };

    const display = DISPLAY_MAP[checkerType];
    if (display) return wrapper(display);

    console.warn(`Unknown quota checker type: ${checkerType}`);
    return wrapper(<SyntheticQuotaDisplay result={result} isCollapsed={false} />);
  };

  const renderQuotaColumns = (groups: [string, QuotaCheckerInfo[]][]) => (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {groups.map(([checkerType, quotasList]) => {
        const displayName = CHECKER_DISPLAY_NAMES[checkerType] || checkerType;
        return (
          <div key={checkerType} className="flex flex-col gap-3">
            <h3 className="font-heading text-xs font-semibold text-text-secondary uppercase tracking-wider px-1 border-b border-border-glass pb-2">
              {displayName}
            </h3>
            <div className="flex flex-col gap-3">
              {quotasList.map((quota) => renderQuotaDisplay(quota, displayName))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Quota Trackers"
        subtitle="Monitor provider quotas and rate limits."
        actions={
          <Button variant="secondary" onClick={fetchQuotas} disabled={loading} leftIcon={<RefreshCw size={16} className={clsx(loading && 'animate-spin')} />}>
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
          {balanceGroups.length > 0 && (
            <section>
              <CombinedBalancesCard
                balanceQuotas={balanceGroups.flatMap(([_, quotasList]) => quotasList)}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                getQuotaResult={getQuotaResult}
              />
            </section>
          )}

          {rateLimitGroups.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border-glass">
                <Cpu size={18} className="text-primary" />
                <h2 className="font-heading text-h2 font-semibold text-text">Rate Limits</h2>
              </div>
              {renderQuotaColumns(rateLimitGroups)}
            </section>
          )}
        </div>
      )}

      {isBalanceModal ? (
        <BalanceHistoryModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          quota={selectedQuota}
          displayName={selectedDisplayName}
        />
      ) : (
        <QuotaHistoryModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          quota={selectedQuota}
          displayName={selectedDisplayName}
        />
      )}
    </PageContainer>
  );
};
