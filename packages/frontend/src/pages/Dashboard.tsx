import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { components } from '@/lib/api-client';
import { RecentActivityChart, type UsageDataPoint } from '@/components/dashboard/RecentActivityChart';
import { Activity, Server, Zap, Database, AlertTriangle } from 'lucide-react';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

export const DashboardPage: React.FC = () => {
  const [state, setState] = useState<components['schemas']['StateGetResponse'] | null>(null);
  const [usageData, setUsageData] = useState<UsageDataPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [timeAgo, setTimeAgo] = useState<string>('Just now');
  const [activityRange, setActivityRange] = useState<TimeRange>('day');
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      setLoading(true);
      const [stateData, logsData] = await Promise.all([
        api.getState(),
        api.queryLogs({ type: 'usage', limit: 100 })
      ]);

      setState(stateData);

      const logs = logsData.entries as unknown as Array<{
        timestamp: string;
        usage: {
          promptTokens: number;
          completionTokens: number;
        };
      }>;

      const processData = (): UsageDataPoint[] => {
        const now = new Date();
        let startTime: Date;

        switch (activityRange) {
          case 'hour':
            startTime = new Date(now.getTime() - 60 * 60 * 1000);
            break;
          case 'day':
            startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case 'week':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }

        const filtered = logs.filter(log => new Date(log.timestamp) >= startTime);

        const grouped = filtered.reduce((acc, log) => {
          const date = new Date(log.timestamp);
          let key: string;

          switch (activityRange) {
            case 'hour':
              key = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
              break;
            case 'day':
              key = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
              break;
            case 'week':
              key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              break;
            case 'month':
              key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              break;
          }

          if (!acc[key]) {
            acc[key] = { timestamp: key, requests: 0, tokens: 0 };
          }
          const entry = acc[key];
          if (entry) {
            entry.requests += 1;
            entry.tokens += (log.usage?.promptTokens ?? 0) + (log.usage?.completionTokens ?? 0);
          }
          return acc;
        }, {} as Record<string, UsageDataPoint>);

        return Object.values(grouped);
      };

      setUsageData(processData());
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
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

  const handleClearCooldowns = async () => {
    if (confirm('Are you sure you want to clear all provider cooldowns?')) {
      try {
        await api.updateState({ action: 'clear-cooldowns', payload: {} });
        loadData();
      } catch (error) {
        alert('Failed to clear cooldowns');
      }
    }
  };

  const calculateStats = () => {
    if (!state) return null;

    const providers = state.providers || [];
    const totalRequests = providers.reduce((sum: number, p: any) => sum + (p.metrics?.requestsLast5Min ?? 0), 0);
    const avgLatency = providers.length > 0
      ? providers.reduce((sum: number, p: any) => sum + (p.metrics?.avgLatency ?? 0), 0) / providers.length
      : 0;
    const successRate = providers.length > 0
      ? providers.reduce((sum: number, p: any) => sum + (p.metrics?.successRate ?? 0), 0) / providers.length
      : 0;
    const totalTokens = usageData.reduce((sum: number, d) => sum + d.tokens, 0);
    const successRateDisplay = Math.round(successRate * 100);

    return {
      totalRequests,
      totalTokens,
      avgLatency,
      successRateDisplay
    };
  };

  const stats = calculateStats();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          {state?.cooldowns && state.cooldowns.length > 0 ? (
            <Badge variant="destructive" className="mt-2">
              System Degraded
            </Badge>
          ) : (
            <Badge variant="default" className="mt-2">
              System Online
            </Badge>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Last updated: {timeAgo}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl fontbold">
              {stats?.totalRequests.toLocaleString() || '-'}
            </div>
            <p className="text-xs text-muted-foreground">Last 5 minutes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Database className="h-4 w-4" />
              Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalTokens.toLocaleString() || '-'}
            </div>
            <p className="text-xs text-muted-foreground">Selected period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Avg Latency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.avgLatency ? `${stats.avgLatency.toFixed(0)}ms` : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Response time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.successRateDisplay !== undefined ? `${stats.successRateDisplay}%` : '-'}
            </div>
            <p className="text-xs text-muted-foreground">Provider average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Requests Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalRequests.toLocaleString() || '-'}
            </div>
            <p className="text-xs text-muted-foreground">Last 5 min window</p>
          </CardContent>
        </Card>
      </div>

      {state?.cooldowns && state.cooldowns.length > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Service Alerts
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearCooldowns}
                className="text-destructive hover:text-destructive"
              >
                Clear All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(() => {
                const groupedCooldowns = state.cooldowns.reduce((acc: Record<string, typeof state.cooldowns>, c: any) => {
                  const provider = c.provider as string;
                  if (!acc[provider]) {
                    acc[provider] = [];
                  }
                  acc[provider]!.push(c);
                  return acc;
                }, {});

                return Object.entries(groupedCooldowns).map(([provider, providerCooldowns]: [string, unknown]) => {
                  const cooldowns = providerCooldowns as Array<{ remaining: number }>;
                  const maxSeconds = Math.max(...cooldowns.map((c) => c.remaining));
                  const minutes = Math.ceil(maxSeconds / 60);

                  return (
                    <div key={provider} className="flex items-center gap-2 p-3 bg-destructive/10 rounded-md">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span className="font-medium">{provider}</span>
                      <span className="text-sm text-muted-foreground">
                        is on cooldown for {minutes} minute{minutes > 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Activity</CardTitle>
            <div className="flex gap-2">
              {(['hour', 'day', 'week', 'month'] as TimeRange[]).map(range => (
                <Button
                  key={range}
                  size="sm"
                  variant={activityRange === range ? 'default' : 'outline'}
                  onClick={() => setActivityRange(range)}
                  className="capitalize"
                >
                  {range}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Loading...
            </div>
          ) : (
            <RecentActivityChart data={usageData} />
          )}
        </CardContent>
      </Card>
    </div>
  );
};