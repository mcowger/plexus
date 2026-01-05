import { useEffect, useState } from 'react';
import { api, UsageData, formatLargeNumber } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

export const Usage = () => {
  const [data, setData] = useState<UsageData[]>([]);
  const [range, setRange] = useState<TimeRange>('week');

  useEffect(() => {
    api.getUsageData(range).then(setData);
  }, [range]);

  const renderTimeControls = () => (
    <div style={{ display: 'flex', gap: '8px' }}>
        {(['hour', 'day', 'week', 'month'] as TimeRange[]).map(r => (
            <Button 
                key={r} 
                size="sm" 
                variant={range === r ? 'primary' : 'secondary'} 
                onClick={() => setRange(r)}
                style={{ textTransform: 'capitalize' }}
            >
                {r}
            </Button>
        ))}
    </div>
  );

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Usage Overview</h1>
        <p className="text-[15px] text-text-secondary m-0">Token usage and request statistics over time.</p>
      </div>

      <div className="flex gap-4 mb-4 flex-col lg:flex-row">
        <Card 
          className="flex-[2] min-w-0"
          title="Requests over Time"
          extra={renderTimeControls()}
        >
          <div style={{ height: 400, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatLargeNumber} />
                <Tooltip
                  contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                  }}
                />
                <Area type="monotone" dataKey="requests" stroke="var(--color-primary)" fill="var(--color-glow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card 
          className="flex-[2] min-w-0"
          title="Token Usage"
          extra={renderTimeControls()}
        >
          <div style={{ height: 400, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatLargeNumber} />
                <Tooltip
                  contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                  }}
                />
                <Legend />
                <Area type="monotone" dataKey="tokens" name="Total Tokens" stroke="var(--color-primary)" fill="var(--color-glow)" fillOpacity={0.1} />
                <Area type="monotone" dataKey="inputTokens" name="Input" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.3} />
                <Area type="monotone" dataKey="outputTokens" name="Output" stroke="#ffc658" fill="#ffc658" fillOpacity={0.3} />
                <Area type="monotone" dataKey="cachedTokens" name="Cached" stroke="#ff7300" fill="#ff7300" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
};
