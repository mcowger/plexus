import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, BarChart2, Gauge } from 'lucide-react';
import { LiveTab } from '../components/dashboard/tabs/LiveTab';
import { UsageTab } from '../components/dashboard/tabs/UsageTab';
import { PerformanceTab } from '../components/dashboard/tabs/PerformanceTab';
import type { CustomDateRange } from '../lib/date';

type TabId = 'live' | 'usage' | 'performance';
type TimeRange = 'hour' | 'day' | 'week' | 'month' | 'custom';
type LiveWindowPeriod = 5 | 15 | 30 | 1440 | 10080 | 43200; // minutes: 5m, 15m, 30m, 1d, 7d, 30d

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'live', label: 'Live Metrics', icon: <Zap size={15} /> },
  { id: 'usage', label: 'Usage Analytics', icon: <BarChart2 size={15} /> },
  { id: 'performance', label: 'Performance', icon: <Gauge size={15} /> },
];

const DEFAULT_POLL_INTERVAL = 10000;
const DEFAULT_LIVE_WINDOW: LiveWindowPeriod = 5;

export const Dashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : 'live';

  const [usageTimeRange, setUsageTimeRange] = useState<TimeRange>('day');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange | null>(null);
  const [pollInterval, setPollInterval] = useState<number>(DEFAULT_POLL_INTERVAL);
  const [liveWindowPeriod, setLiveWindowPeriod] = useState<LiveWindowPeriod>(DEFAULT_LIVE_WINDOW);

  const setTab = (id: TabId) => {
    setSearchParams(id === 'live' ? {} : { tab: id });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border-glass bg-bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex gap-0 px-4">
          {TABS.map((tab) => {
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
