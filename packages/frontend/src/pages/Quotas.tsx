import { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { RefreshCw, Cpu } from 'lucide-react';
import { clsx } from 'clsx';
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
  OpenRouterQuotaDisplay,
  KiloQuotaDisplay,
  CopilotQuotaDisplay,
  WisdomGateQuotaDisplay,
  CombinedBalancesCard,
  QuotaHistoryModal,
  BalanceHistoryModal,
} from '../components/quota';

// Checker type categories
const BALANCE_CHECKERS = ['openrouter', 'minimax', 'moonshot', 'naga', 'kilo', 'apertis'];
const RATE_LIMIT_CHECKERS = ['openai-codex', 'codex', 'claude-code', 'claude', 'zai', 'synthetic', 'nanogpt', 'copilot', 'wisdomgate'];

// Checker display names
const CHECKER_DISPLAY_NAMES: Record<string, string> = {
  'openrouter': 'OpenRouter',
  'minimax': 'MiniMax',
  'moonshot': 'Moonshot',
  'naga': 'Naga',
  'kilo': 'Kilo',
  'openai-codex': 'OpenAI Codex',
  'codex': 'Codex',
  'claude-code': 'Claude Code',
  'claude': 'Claude',
  'zai': 'ZAI',
  'synthetic': 'Synthetic',
  'nanogpt': 'NanoGPT',
  'copilot': 'GitHub Copilot',
  'wisdomgate': 'Wisdom Gate',
};

export const Quotas = () => {
  const [quotas, setQuotas] = useState<QuotaCheckerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [selectedQuota, setSelectedQuota] = useState<QuotaCheckerInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDisplayName, setSelectedDisplayName] = useState('');
  const [isBalanceModal, setIsBalanceModal] = useState(false);

  // Check if a quota is a balance-based checker
  const isBalanceChecker = (quota: QuotaCheckerInfo): boolean => {
    const checkerType = (quota.checkerType || quota.checkerId).toLowerCase();
    return BALANCE_CHECKERS.some(bc => checkerType.includes(bc));
  };

  const fetchQuotas = async () => {
    setLoading(true);
    const data = await api.getQuotas();
    setQuotas(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchQuotas();
    // Refresh quotas every 30 seconds
    const interval = setInterval(fetchQuotas, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async (checkerId: string) => {
    setRefreshing(prev => new Set(prev).add(checkerId));
    await api.triggerQuotaCheck(checkerId);
    await fetchQuotas();
    setRefreshing(prev => {
      const next = new Set(prev);
      next.delete(checkerId);
      return next;
    });
  };

  // Convert QuotaSnapshot to QuotaCheckResult format for display
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

    // Get unique window types (in case of duplicates, take the most recent)
    const windowsByType = new Map<string, typeof quota.latest[0]>();
    for (const snapshot of quota.latest) {
      const existing = windowsByType.get(snapshot.windowType);
      if (!existing || snapshot.checkedAt > existing.checkedAt) {
        windowsByType.set(snapshot.windowType, snapshot);
      }
    }

    const windows = Array.from(windowsByType.values()).map(snapshot => ({
      windowType: snapshot.windowType as any,
      windowLabel: snapshot.description || snapshot.windowType,
      limit: snapshot.limit ?? undefined,
      used: snapshot.used ?? undefined,
      remaining: snapshot.remaining ?? undefined,
      utilizationPercent: snapshot.utilizationPercent ?? 0,
      unit: (snapshot.unit as any) || 'percentage',
      resetsAt: toIsoString(snapshot.resetsAt) ?? undefined,
      resetInSeconds: snapshot.resetInSeconds !== null && snapshot.resetInSeconds !== undefined ? snapshot.resetInSeconds : undefined,
      status: (snapshot.status as any) || 'ok',
    }));

    const firstSnapshot = quota.latest[0];
    const errorFromSnapshots = quota.latest.find((snapshot) => snapshot.errorMessage)?.errorMessage || undefined;
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

  // Group quotas by checker type
  const groupedQuotas = useMemo(() => {
    const groups: Record<string, QuotaCheckerInfo[]> = {};

    for (const quota of quotas) {
      const checkerType = (quota.checkerType || '').toLowerCase();
      const checkerId = quota.checkerId.toLowerCase();
      
      // Determine the base checker type
      let baseType = checkerType || checkerId;
      
      // Normalize checker type names
      if (baseType.includes('openai-codex') || baseType.includes('codex')) {
        baseType = 'codex';
      } else if (baseType.includes('claude-code') || baseType.includes('claude')) {
        baseType = 'claude-code';
      } else if (baseType.includes('openrouter')) {
        baseType = 'openrouter';
      } else if (baseType.includes('minimax')) {
        baseType = 'minimax';
      } else if (baseType.includes('moonshot')) {
        baseType = 'moonshot';
      } else if (baseType.includes('naga')) {
        baseType = 'naga';
      } else if (baseType.includes('kilo')) {
        baseType = 'kilo';
      } else if (baseType.includes('zai')) {
        baseType = 'zai';
      } else if (baseType.includes('synthetic')) {
        baseType = 'synthetic';
      } else if (baseType.includes('nanogpt')) {
        baseType = 'nanogpt';
      } else if (baseType.includes('wisdomgate')) {
        baseType = 'wisdomgate';
      }

      if (!groups[baseType]) {
        groups[baseType] = [];
      }
      groups[baseType].push(quota);
    }

    return groups;
  }, [quotas]);

  // Separate into balance and rate limit categories
  const balanceGroups = useMemo(() => {
    return Object.entries(groupedQuotas)
      .filter(([type]) => BALANCE_CHECKERS.some(bc => type.includes(bc)))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [groupedQuotas]);

  const rateLimitGroups = useMemo(() => {
    return Object.entries(groupedQuotas)
      .filter(([type]) => RATE_LIMIT_CHECKERS.some(rc => type.includes(rc)))
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

  // Render the appropriate quota display component based on checker type
  const renderQuotaDisplay = (quota: QuotaCheckerInfo, groupDisplayName: string) => {
    const result = getQuotaResult(quota);
    const checkerIdentifier = (quota.checkerType || quota.checkerId).toLowerCase();
    
    // Add refresh button wrapper
    const wrapper = (children: React.ReactNode) => (
      <div 
        key={quota.checkerId} 
        onClick={() => handleCardClick(quota, groupDisplayName)}
        className="bg-bg-card border border-border rounded-lg p-4 relative cursor-pointer hover:border-primary/50 transition-colors"
      >
        <div className="absolute top-2 right-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              handleRefresh(quota.checkerId);
            }}
            disabled={refreshing.has(quota.checkerId)}
          >
            <RefreshCw size={14} className={clsx(refreshing.has(quota.checkerId) && 'animate-spin')} />
          </Button>
        </div>
        <div className="pr-8">
          {children}
        </div>
      </div>
    );

    // Use the appropriate display component based on checker type
    if (checkerIdentifier.includes('synthetic')) {
      return wrapper(<SyntheticQuotaDisplay result={result} isCollapsed={false} />);
    }
    
    if (checkerIdentifier.includes('claude')) {
      return wrapper(<ClaudeCodeQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('naga')) {
      return wrapper(<NagaQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('nanogpt')) {
      return wrapper(<NanoGPTQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('openai-codex') || checkerIdentifier.includes('codex')) {
      return wrapper(<OpenAICodexQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('zai')) {
      return wrapper(<ZAIQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('moonshot')) {
      return wrapper(<MoonshotQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('minimax')) {
      return wrapper(<MiniMaxQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('openrouter')) {
      return wrapper(<OpenRouterQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('kilo')) {
      return wrapper(<KiloQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('copilot')) {
      return wrapper(<CopilotQuotaDisplay result={result} isCollapsed={false} />);
    }

    if (checkerIdentifier.includes('wisdomgate')) {
      return wrapper(<WisdomGateQuotaDisplay result={result} isCollapsed={false} />);
    }

    // Fallback: generic display
    console.warn(`Unknown quota checker type: ${quota.checkerType || quota.checkerId}`);
    return wrapper(<SyntheticQuotaDisplay result={result} isCollapsed={false} />);
  };

  // Render columns for checker types (responsive grid)
  const renderQuotaColumns = (groups: [string, QuotaCheckerInfo[]][]) => {
    return (
      <div 
        className="grid gap-4" 
        style={{ 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        }}
      >
        {groups.map(([checkerType, quotasList]) => {
          const displayName = CHECKER_DISPLAY_NAMES[checkerType] || checkerType;
          
          return (
            <div key={checkerType} className="flex flex-col gap-3">
              <h3 className="font-heading text-sm font-semibold text-text-secondary uppercase tracking-wider px-1 border-b border-border pb-2">
                {displayName}
              </h3>
              <div className="flex flex-col gap-3">
                {quotasList.map(quota => renderQuotaDisplay(quota, displayName))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Quota Trackers</h1>
          <p className="text-[15px] text-text-secondary m-0">Monitor provider quotas and rate limits.</p>
        </div>
        <Button
          variant="secondary"
          onClick={fetchQuotas}
          disabled={loading}
        >
          <RefreshCw size={16} className={clsx('mr-2', loading && 'animate-spin')} />
          Refresh All
        </Button>
      </div>

      {loading && quotas.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={24} className="animate-spin text-primary mr-2" />
          <span className="text-text-secondary">Loading quotas...</span>
        </div>
      ) : quotas.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-text-secondary">No quota checkers configured</p>
            <p className="text-text-muted text-sm mt-2">
              Configure quota checkers in your provider settings to monitor usage.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Combined Balances Card */}
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

          {/* Rate Limit Section */}
          {rateLimitGroups.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-6 pb-2 border-b border-border">
                <Cpu size={20} className="text-primary" />
                <h2 className="font-heading text-xl font-semibold text-text">Rate Limits</h2>
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
    </div>
  );
};
