import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

interface UsageDataPoint {
  timestamp: string;
  requests: number;
}

interface TokenDataPoint {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

interface DistributionData extends Record<string, unknown> {
  name: string;
  requests: number;
  tokens: number;
}

export const UsagePage: React.FC = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [loading, setLoading] = useState(true);
  const [requestsData, setRequestsData] = useState<UsageDataPoint[]>([]);
  const [tokensData, setTokensData] = useState<TokenDataPoint[]>([]);
  const [modelRequestsData, setModelRequestsData] = useState<DistributionData[]>([]);
  const [modelTokensData, setModelTokensData] = useState<DistributionData[]>([]);
  const [providerRequestsData, setProviderRequestsData] = useState<DistributionData[]>([]);
  const [providerTokensData, setProviderTokensData] = useState<DistributionData[]>([]);
  const [keyRequestsData, setKeyRequestsData] = useState<DistributionData[]>([]);
  const [keyTokensData, setKeyTokensData] = useState<DistributionData[]>([]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

  const loadData = async () => {
    try {
      setLoading(true);
      const logsData = await api.queryLogs({ type: 'usage', limit: 1000 });

      const logs = logsData.entries as unknown as Array<{
        timestamp: string;
        requestedModel?: string;
        provider?: string;
        apiKey?: string;
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          reasoningTokens?: number;
          cachedTokens?: number;
        };
      }>;

      const now = new Date();
      let startTime: Date;

      switch (timeRange) {
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

        const processTimeData = () => {
          const requestsMap = new Map<string, number>();
          const tokensMap = new Map<string, TokenDataPoint>();

          filtered.forEach(log => {
            const date = new Date(log.timestamp);
            let key: string;

            if (timeRange === 'hour' || timeRange === 'day') {
              key = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
            } else {
              key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }

            requestsMap.set(key, (requestsMap.get(key) || 0) + 1);

            const current = tokensMap.get(key);
            tokensMap.set(key, {
              timestamp: key,
              inputTokens: (current?.inputTokens ?? 0) + (log.usage?.promptTokens ?? 0),
              outputTokens: (current?.outputTokens ?? 0) + (log.usage?.completionTokens ?? 0),
              reasoningTokens: (current?.reasoningTokens ?? 0) + (log.usage?.reasoningTokens ?? 0),
              cachedTokens: (current?.cachedTokens ?? 0) + (log.usage?.cachedTokens ?? 0)
            });
          });

        const requests = Array.from(requestsMap.entries()).map(([timestamp, requests]) => ({
          timestamp,
          requests
        }));

        const tokens = Array.from(tokensMap.entries()).map(([timestamp, data]) => ({
          timestamp,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          reasoningTokens: data.reasoningTokens,
          cachedTokens: data.cachedTokens
        }));

        return { requests, tokens };
      };

      const processDistributionData = (keyField: 'requestedModel' | 'provider' | 'apiKey') => {
        const map = new Map<string, { requests: number; tokens: number }>();

        filtered.forEach(log => {
          const key = log[keyField] || 'Unknown';
          if (!map.has(key)) {
            map.set(key, { requests: 0, tokens: 0 });
          }
          const data = map.get(key)!;
          data.requests += 1;
          data.tokens += (log.usage?.promptTokens || 0) + (log.usage?.completionTokens || 0) +
            (log.usage?.reasoningTokens || 0) + (log.usage?.cachedTokens || 0);
        });

        return Array.from(map.entries()).map(([name, data]) => ({
          name,
          requests: data.requests,
          tokens: data.tokens
        })).sort((a, b) => b.requests - a.requests);
      };

      const timeData = processTimeData();
      setRequestsData(timeData.requests);
      setTokensData(timeData.tokens);
      setModelRequestsData(processDistributionData('requestedModel'));
      setModelTokensData(processDistributionData('requestedModel'));
      setProviderRequestsData(processDistributionData('provider'));
      setProviderTokensData(processDistributionData('provider'));
      setKeyRequestsData(processDistributionData('apiKey'));
      setKeyTokensData(processDistributionData('apiKey'));
    } catch (error) {
      console.error('Failed to load usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [timeRange]);

  const formatNumber = (value: number): string => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return String(value);
  };

  const renderPieChart = (data: DistributionData[], metric: 'requests' | 'tokens', _title: string) => {
    if (!data || data.length === 0) {
      return (
        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
          No data available
        </div>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey={metric}
            nameKey="name"
            cx="50%"
            cy="50%"
            labelLine={false}
                      label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
            outerRadius={80}
          >
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
            </Pie>
            <Tooltip formatter={(value: number | undefined) => value !== undefined ? formatNumber(value) : ''} />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Usage Analytics</h1>
        <div className="flex gap-2">
          {(['hour', 'day', 'week', 'month'] as TimeRange[]).map(range => (
            <Button
              key={range}
              size="sm"
              variant={timeRange === range ? 'default' : 'outline'}
              onClick={() => setTimeRange(range)}
              className="capitalize"
            >
              {range}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[500px] text-muted-foreground">
          Loading...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Requests Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {requestsData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={requestsData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                    />
                    <YAxis
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      tickFormatter={formatNumber}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        borderColor: 'hsl(var(--border))'
                      }}
                      formatter={(value: number | undefined) => value !== undefined ? formatNumber(value) : ''}
                    />
                    <Area
                      type="monotone"
                      dataKey="requests"
                      name="Requests"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary))"
                      fillOpacity={0.3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Token Usage</CardTitle>
            </CardHeader>
            <CardContent>
               {tokensData.length > 0 ? (
                 <ResponsiveContainer width="100%" height={300}>
                   <AreaChart data={tokensData}>
                     <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                     <XAxis
                       dataKey="timestamp"
                       tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                       tickLine={false}
                       axisLine={{ stroke: 'hsl(var(--border))' }}
                     />
                     <YAxis
                       tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                       tickLine={false}
                       axisLine={{ stroke: 'hsl(var(--border))' }}
                       tickFormatter={formatNumber}
                     />
                     <Tooltip
                       contentStyle={{
                         backgroundColor: 'hsl(var(--background))',
                         borderColor: 'hsl(var(--border))'
                       }}
                       formatter={(value: number | undefined) => value !== undefined ? formatNumber(value) : ''}
                     />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="inputTokens"
                      name="Input"
                      stackId="1"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.6}
                    />
                    <Area
                      type="monotone"
                      dataKey="outputTokens"
                      name="Output"
                      stackId="1"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.6}
                    />
                    <Area
                      type="monotone"
                      dataKey="reasoningTokens"
                      name="Reasoning"
                      stackId="1"
                      stroke="#f59e0b"
                      fill="#f59e0b"
                      fillOpacity={0.6}
                    />
                    <Area
                      type="monotone"
                      dataKey="cachedTokens"
                      name="Cached"
                      stackId="1"
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.6}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model Distribution (by Requests)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(modelRequestsData, 'requests', '')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model Distribution (by Tokens)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(modelTokensData, 'tokens', '')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider Distribution (by Requests)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(providerRequestsData, 'requests', '')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider Distribution (by Tokens)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(providerTokensData, 'tokens', '')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Key Distribution (by Requests)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(keyRequestsData, 'requests', '')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Key Distribution (by Tokens)</CardTitle>
            </CardHeader>
            <CardContent>
              {renderPieChart(keyTokensData, 'tokens', '')}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export { LogsPage } from './Logs';

export { ProvidersPage } from './Providers';

export { ModelsPage } from './Models';

export { KeysPage } from './Keys';

export { ConfigPage } from './Config';

export { DebugPage } from './Debug';

export { ErrorsPage } from './Errors';

export const NotFoundPage: React.FC = () => {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">404 - Page Not Found</h1>
      <Card>
        <CardHeader>
          <CardTitle>Not Found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">The page you are looking for does not exist.</p>
        </CardContent>
      </Card>
    </div>
  );
};
