import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, BarChart2, Gauge, LayoutDashboard } from 'lucide-react';
import { LiveTab } from '../components/dashboard/tabs/LiveTab';
import { UsageTab } from '../components/dashboard/tabs/UsageTab';
import { PerformanceTab } from '../components/dashboard/tabs/PerformanceTab';
import { OverallTab } from '../components/dashboard/tabs/OverallTab';
import { Tabs } from '../components/ui/Tabs';
import { useAuth } from '../contexts/AuthContext';
import type { CustomDateRange } from '../lib/date';

type TabId = 'overall' | 'live' | 'usage' | 'performance';
type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'custom';
type LiveWindowPeriod = 5 | 15 | 30 | 1440 | 10080 | 43200;

const BASE_TABS = [
  { value: 'live' as const, label: <span className="inline-flex items-center gap-2"><Zap size={14} /> Live Metrics</span> },
  { value: 'usage' as const, label: <span className="inline-flex items-center gap-2"><BarChart2 size={14} /> Usage Analytics</span> },
  { value: 'performance' as const, label: <span className="inline-flex items-center gap-2"><Gauge size={14} /> Performance</span> },
];

const OVERALL_TAB = {
  value: 'overall' as const,
  label: <span className="inline-flex items-center gap-2"><LayoutDashboard size={14} /> Overall</span>,
};

const DEFAULT_POLL_INTERVAL = 10000;
const DEFAULT_LIVE_WINDOW: LiveWindowPeriod = 5;

export const Dashboard = () => {
  const { isLimited } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;

  const tabs = useMemo(() => (isLimited ? [OVERALL_TAB, ...BASE_TABS] : BASE_TABS), [isLimited]);

  const defaultTabId: TabId = isLimited ? 'overall' : 'live';
  const activeTab: TabId =
    tabParam && tabs.some((t) => t.value === tabParam) ? tabParam : defaultTabId;

  const [usageTimeRange, setUsageTimeRange] = useState<TimeRange>('day');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(DEFAULT_POLL_INTERVAL);
  const [liveWindowPeriod, setLiveWindowPeriod] = useState<LiveWindowPeriod>(DEFAULT_LIVE_WINDOW);

  const setTab = (id: TabId) => {
    setSearchParams(id === defaultTabId ? {} : { tab: id });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  return (
    <div className="flex flex-col min-h-full -mx-4 sm:-mx-6 lg:-mx-8 -mt-4 sm:-mt-6 lg:-mt-8">
      <div className="sticky top-0 z-10 border-b border-border-glass bg-bg-surface/80 backdrop-blur-md px-2 sm:px-4">
        <Tabs<TabId>
          value={activeTab}
          onChange={setTab}
          items={tabs}
          variant="underline"
          aria-label="Dashboard sections"
        />
      </div>

      <div className="flex-1 px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-8">
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
