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
    <div className="dashboard">
      <div className="page-header">
          <div className="header-left">
            <h1 className="page-title">Dashboard</h1>
            {cooldowns.length > 0 ? (
                <Badge status="warning" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>System Degraded</Badge>
            ) : (
                <Badge status="connected" secondaryText={`Last updated: ${timeAgo}`} style={{ minWidth: '190px' }}>System Online</Badge>
            )}
          </div>
      </div>

      <div className="stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className="stat-card">
            <div className="stat-header">
                <span className="stat-label">{stat.label}</span>
                 <div className="stat-icon" style={{background: 'var(--color-bg-hover)'}}>
                    {icons[stat.label] || <Activity size={20} />}
                 </div>
            </div>
            <div className="stat-value">{stat.value}</div>
            {stat.change && (
                <div className={`stat-meta ${stat.change > 0 ? 'success' : 'failure'}`}>
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
                extra={<button className="btn btn-sm btn-ghost" onClick={handleClearCooldowns} style={{color: 'var(--color-warning)'}}>Clear All</button>}
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

      <div className="charts-row">
          <Card className="chart-large" title="Recent Activity">
             <RecentActivityChart data={usageData} />
          </Card>
          <Card className="chart-small" title="Quick Actions">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="btn btn-primary" style={{ width: '100%' }}>New Provider</button>
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => navigate('/logs')}>View Logs</button>
              </div>
          </Card>
      </div>
    </div>
  );
};
