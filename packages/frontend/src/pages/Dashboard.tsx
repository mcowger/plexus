import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { api, Stat, UsageData, Cooldown, STAT_LABELS } from '../lib/api';
import { Activity, Server, Zap, Database, AlertTriangle } from 'lucide-react';
import { RecentActivityChart } from '../components/dashboard/RecentActivityChart';

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
  const navigate = useNavigate();

  const loadData = async () => {
      const [statsData, usage, cooldownsData] = await Promise.all([
          api.getStats(),
          api.getUsageData(),
          api.getCooldowns()
      ]);
      setStats(statsData);
      setUsageData(usage);
      setCooldowns(cooldownsData);
      setLastUpdated(new Date());
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

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

      <div className="grid gap-4 mb-6 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
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
                      {cooldowns.map(c => (
                          <div key={c.provider} style={{display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'rgba(255, 171, 0, 0.1)', borderRadius: '4px'}}>
                              <AlertTriangle size={16} color="var(--color-warning)"/>
                              <span style={{fontWeight: 500}}>{c.provider}</span>
                              <span style={{color: 'var(--color-text-secondary)'}}>is on cooldown for {Math.ceil(c.timeRemainingMs / 60000)} minutes</span>
                          </div>
                      ))}
                  </div>
              </Card>
          </div>
      )}

      <div className="flex gap-4 mb-4 flex-col lg:flex-row">
          <Card className="flex-[2] min-w-0" title="Recent Activity">
             <RecentActivityChart data={usageData} />
          </Card>
          <Card className="flex-1 min-w-[300px]" title="Quick Actions">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="text-black shadow-md bg-gradient-to-br from-primary to-secondary shadow-[0_4px_12px_rgba(245,158,11,0.3)] hover:disabled:transform-none hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)] inline-flex items-center justify-center gap-2 py-2.5 px-5 font-body text-sm font-medium leading-normal border-0 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap select-none outline-none disabled:opacity-50 disabled:cursor-not-allowed" style={{ width: '100%' }}>New Provider</button>
                  <button className="bg-bg-glass text-text border border-border-glass backdrop-blur-md hover:bg-bg-hover hover:border-primary inline-flex items-center justify-center gap-2 py-2.5 px-5 font-body text-sm font-medium leading-normal border-0 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap select-none outline-none disabled:opacity-50 disabled:cursor-not-allowed" style={{ width: '100%' }} onClick={() => navigate('/logs')}>View Logs</button>
              </div>
          </Card>
      </div>
    </div>
  );
};
