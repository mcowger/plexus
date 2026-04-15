import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, BarChart2, Gauge, LayoutDashboard } from 'lucide-react';
import { LiveTab } from '../components/dashboard/tabs/LiveTab';
import { UsageTab } from '../components/dashboard/tabs/UsageTab';
import { PerformanceTab } from '../components/dashboard/tabs/PerformanceTab';
import { OverallTab } from '../components/dashboard/tabs/OverallTab';
import { useAuth } from '../contexts/AuthContext';
import type { CustomDateRange } from '../lib/date';

type TabId = 'overall' | 'live' | 'usage' | 'performance';
type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'custom';
type LiveWindowPeriod = 5 | 15 | 30 | 1440 | 10080 | 43200; // minutes: 5m, 15m, 30m, 1d, 7d, 30d

// Tabs visible to every authenticated principal. Admins see only these; limited
// users additionally see the `overall` tab prepended below.
const BASE_TABS: { id: Exclude<TabId, 'overall'>; label: string; icon: React.ReactNode }[] = [
  { id: 'live', label: 'Live Metrics', icon: <Zap size={15} /> },
  { id: 'usage', label: 'Usage Analytics', icon: <BarChart2 size={15} /> },
  { id: 'performance', label: 'Performance', icon: <Gauge size={15} /> },
];

const OVERALL_TAB: { id: TabId; label: string; icon: React.ReactNode } = {
  id: 'overall',
  label: 'Overall',
  icon: <LayoutDashboard size={15} />,
};

const DEFAULT_POLL_INTERVAL = 10000;
const DEFAULT_LIVE_WINDOW: LiveWindowPeriod = 5;

export const Dashboard = () => {
  const { isLimited } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;

  // Limited users get an extra "Overall" tab (their access + usage rollup).
  // It's prepended so that for an api-key user the most relevant view is the
  // first thing they see. Admins don't need it — they already have full
  // cross-key analytics in the Usage tab.
  const tabs = useMemo(() => (isLimited ? [OVERALL_TAB, ...BASE_TABS] : BASE_TABS), [isLimited]);

  // Default tab: 'overall' for limited users, 'live' for admins. Any invalid
  // `?tab=` query param falls back to the default for this principal.
  const defaultTabId: TabId = isLimited ? 'overall' : 'live';
  const activeTab: TabId =
    tabParam && tabs.some((t) => t.id === tabParam) ? tabParam : defaultTabId;

  const [usageTimeRange, setUsageTimeRange] = useState<TimeRange>('day');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(DEFAULT_POLL_INTERVAL);
  const [liveWindowPeriod, setLiveWindowPeriod] = useState<LiveWindowPeriod>(DEFAULT_LIVE_WINDOW);

  const setTab = (id: TabId) => {
    // The default tab is represented with no `?tab=` param (cleaner URLs).
    // Everything else round-trips through the query string.
    setSearchParams(id === defaultTabId ? {} : { tab: id });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border-glass bg-bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex gap-0 px-4">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={[
                  'flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-all border-b-2 -mb-px',
                  isActive
                    ? 'border-accent text-text'
                    : 'border-transparent text-text-muted hover:text-text hover:border-border-glass',
                ].join(' ')}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === 'overall' && isLimited && <OverallTab />}
        {activeTab === 'live' && (
          <LiveTab
            pollInterval={pollInterval}
            onPollIntervalChange={setPollInterval}
            liveWindowPeriod={liveWindowPeriod}
            onLiveWindowPeriodChange={(period: number) =>
              setLiveWindowPeriod(period as LiveWindowPeriod)
            }
          />
        )}
        {activeTab === 'usage' && (
          <UsageTab
            timeRange={usageTimeRange}
            onTimeRangeChange={setUsageTimeRange}
            customDateRange={customDateRange}
            onCustomDateRangeChange={setCustomDateRange}
          />
        )}
        {activeTab === 'performance' && <PerformanceTab />}
      </div>
    </div>
  );
};
