import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api, Stat, UsageData, Cooldown, STAT_LABELS, TodayMetrics } from '../lib/api';
import { formatCost, formatNumber, formatTokens } from '../lib/format';
import { Activity, Server, Zap, Database, AlertTriangle } from 'lucide-react';
import { RecentActivityChart } from '../components/dashboard/RecentActivityChart';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

const icons: Record<string, React.ReactNode> = {
  [STAT_LABELS.REQUESTS]: <Activity size={20} />,
  [STAT_LABELS.PROVIDERS]: <Server size={20} />,
  [STAT_LABELS.TOKENS]: <Database size={20} />,
  [STAT_LABELS.DURATION]: <Zap size={20} />,
};

export const Dashboard = () => {
  const [stats, setStats] = useState<Stat[]>([]);
  const [usageData, setUsageData] = useState<UsageData[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Just now');
  const [activityRange, setActivityRange] = useState<TimeRange>('day');
  const [todayMetrics, setTodayMetrics] = useState<TodayMetrics>({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalCost: 0
  });

  const loadData = async () => {
      const dashboardData = await api.getDashboardData(activityRange);
      setStats(dashboardData.stats.filter(stat =>
        stat.label !== STAT_LABELS.PROVIDERS &&
        stat.label !== STAT_LABELS.DURATION
      ));
      setUsageData(dashboardData.usageData);
      setCooldowns(dashboardData.cooldowns);
      setTodayMetrics(dashboardData.todayMetrics);
      setLastUpdated(new Date());
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [activityRange]);

  useEffect(() => {
      const updateTime = () => {
          const now = new Date();
          const diff = Math.floor((now.getTime() - lastUpdated.getTime()) / 1000);
          
          if (diff < 5) {
              setTimeAgo('Just now');
          } else if (diff < 60) {
              setTimeAgo(`${diff} seconds ago`);
          } else if (diff < 3600) {
              const mins = Math.floor(diff / 60);
              setTimeAgo(`${mins} minute${mins > 1 ? 's' : ''} ago`);
          } else {
              const hours = Math.floor(diff / 3600);
              setTimeAgo(`${hours} hour${hours > 1 ? 's' : ''} ago`);
          }
      };

      updateTime();
      const interval = setInterval(updateTime, 10000);
      return () => clearInterval(interval);
  }, [lastUpdated]);

  const renderActivityTimeControls = () => (
    <div style={{ display: 'flex', gap: '8px' }}>
      {(['hour', 'day', 'week', 'month'] as TimeRange[]).map(r => (
        <Button
          key={r}
          size="sm"
          variant={activityRange === r ? 'primary' : 'secondary'}
          onClick={() => setActivityRange(r)}
          style={{ textTransform: 'capitalize' }}
        >
          {r}
        </Button>
      ))}
    </div>
  );

  const handleClearCooldowns = async () => {
      if (confirm('Are you sure you want to clear all provider cooldowns?')) {
          try {
              await api.clearCooldown();
              loadData();
          } catch (e) {
              alert('Failed to clear cooldowns');
          }
      }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
          <div className="header-left">
            <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Dashboard</h1>
            {cooldowns.length > 0 ? (
                <Badge status="warning" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>System Degraded</Badge>
            ) : (
                <Badge status="connected" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>System Online</Badge>
            )}
          </div>
      </div>

      <div className="mb-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
        {stats.map((stat, i) => (
          <div key={i} className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
            <div className="flex justify-between items-start">
                <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">{stat.label}</span>
                 <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{background: 'var(--color-bg-hover)'}}>
                    {icons[stat.label] || <Activity size={20} />}
                 </div>
            </div>
            <div className="font-heading text-3xl font-bold text-text my-1">{stat.value}</div>
            {stat.change && (
                <div className={`text-sm leading-normal ${stat.change > 0 ? 'text-success' : 'text-danger'}`}>
                    {stat.change > 0 ? '+' : ''}{stat.change}% from last week
                </div>
            )}
          </div>
        ))}

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Requests Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{background: 'var(--color-bg-hover)'}}>
              <Activity size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatNumber(todayMetrics.requests, 0)}</div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Tokens Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{background: 'var(--color-bg-hover)'}}>
              <Database size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatTokens(todayMetrics.inputTokens + todayMetrics.outputTokens + todayMetrics.reasoningTokens + todayMetrics.cachedTokens)}</div>
          <div className="text-xs text-text-muted space-y-0.5">
            <div>In: {formatTokens(todayMetrics.inputTokens)}</div>
            <div>Out: {formatTokens(todayMetrics.outputTokens)}</div>
            {todayMetrics.reasoningTokens > 0 && <div>Reasoning: {formatTokens(todayMetrics.reasoningTokens)}</div>}
            {todayMetrics.cachedTokens > 0 && <div>Cached: {formatTokens(todayMetrics.cachedTokens)}</div>}
          </div>
        </div>

        <div className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300">
          <div className="flex justify-between items-start">
            <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">Cost Today</span>
            <div className="w-8 h-8 rounded-sm flex items-center justify-center text-white" style={{background: 'var(--color-bg-hover)'}}>
              <Zap size={20} />
            </div>
          </div>
          <div className="font-heading text-3xl font-bold text-text my-1">{formatCost(todayMetrics.totalCost, 4)}</div>
        </div>
      </div>

      {cooldowns.length > 0 && (
          <div style={{marginBottom: '24px'}}>
              <Card
                title="Service Alerts"
                className="alert-card"
                style={{borderColor: 'var(--color-warning)'}}
                extra={<button className="bg-transparent text-text border-0 hover:bg-amber-500/10 !py-1.5 !px-3.5 !text-xs" onClick={handleClearCooldowns} style={{color: 'var(--color-warning)'}}>Clear All</button>}
              >
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                      {(() => {
                          // Group cooldowns by provider+model
                          const groupedCooldowns = cooldowns.reduce((acc, c) => {
                              const key = `${c.provider}:${c.model}`;
                              if (!acc[key]) {
                                  acc[key] = [];
                              }
                              acc[key].push(c);
                              return acc;
                          }, {} as Record<string, Cooldown[]>);

                          return Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
                              const [provider, model] = key.split(':');
                              const hasAccountId = modelCooldowns.some(c => c.accountId);
                              const maxTime = Math.max(...modelCooldowns.map(c => c.timeRemainingMs));
                              const minutes = Math.ceil(maxTime / 60000);

                              let statusText: string;
                              const modelDisplay = model || 'all models';

                              if (hasAccountId && modelCooldowns.length > 1) {
                                  statusText = `${modelDisplay} has ${modelCooldowns.length} accounts on cooldown for up to ${minutes} minutes`;
                              } else if (hasAccountId && modelCooldowns.length === 1) {
                                  statusText = `${modelDisplay} has 1 account on cooldown for ${minutes} minutes`;
                              } else {
                                  statusText = `${modelDisplay} is on cooldown for ${minutes} minutes`;
                              }

                              return (
                                  <div key={key} style={{display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'rgba(255, 171, 0, 0.1)', borderRadius: '4px'}}>
                                      <AlertTriangle size={16} color="var(--color-warning)"/>
                                      <span style={{fontWeight: 500}}>{provider}</span>
                                      <span style={{color: 'var(--color-text-secondary)'}}>{statusText}</span>
                                  </div>
                              );
                          });
                      })()}
                  </div>
              </Card>
          </div>
      )}


      <div className="flex gap-4 mb-4 flex-col lg:flex-row">
          <Card className="flex-[2] min-w-0" title="Recent Activity" extra={renderActivityTimeControls()}>
             <RecentActivityChart data={usageData} />
          </Card>
      </div>
    </div>
  );
};
