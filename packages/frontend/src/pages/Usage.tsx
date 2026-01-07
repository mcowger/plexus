import { useEffect, useState } from 'react';
import { api, UsageData, PieChartDataPoint } from '../lib/api';
import { formatNumber, formatTokens } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';

type TimeRange = 'hour' | 'day' | 'week' | 'month';

export const Usage = () => {
  const [data, setData] = useState<UsageData[]>([]);
  const [modelData, setModelData] = useState<PieChartDataPoint[]>([]);
  const [providerData, setProviderData] = useState<PieChartDataPoint[]>([]);
  const [keyData, setKeyData] = useState<PieChartDataPoint[]>([]);
  const [range, setRange] = useState<TimeRange>('week');

  useEffect(() => {
    api.getUsageData(range).then(setData);
    api.getUsageByModel(range).then(setModelData);
    api.getUsageByProvider(range).then(setProviderData);
    api.getUsageByKey(range).then(setKeyData);
  }, [range]);

  const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#ec4899', '#f97316'];

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

  const renderPieChart = (dataKey: 'requests' | 'tokens', data: PieChartDataPoint[]) => {
    const CustomTooltip = ({ active, payload }: any) => {
      if (active && payload && payload.length) {
        const value = payload[0].value;
        const label = payload[0].name;
        const formattedValue = dataKey === 'requests' ? formatNumber(value) : formatTokens(value);
        return (
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            padding: '8px 12px',
            borderRadius: '4px',
            border: '1px solid var(--color-border)'
          }}>
            <p style={{ margin: 0, color: '#ffffff', fontSize: '14px' }}>
              <strong>{label}</strong>
            </p>
            <p style={{ margin: '4px 0 0 0', color: '#ffffff', fontSize: '13px' }}>
              {dataKey === 'requests' ? 'Requests' : 'Tokens'}: {formattedValue}
            </p>
          </div>
        );
      }
      return null;
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="30%"
            labelLine={false}
            outerRadius={50}
            fill="#8884d8"
            dataKey={dataKey}
            nameKey="name"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            align="left"
            height={36}
            formatter={(value) => {
              const item = data.find(d => d.name === value);
              if (!item) return value;
              const itemValue = item[dataKey as keyof PieChartDataPoint] as number;
              const total = data.reduce((sum, d) => sum + (d[dataKey as keyof PieChartDataPoint] as number), 0);
              const percent = total > 0 ? ((itemValue / total) * 100).toFixed(0) : 0;
              return `${value} (${percent}%)`;
            }}
          />
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Usage Overview</h1>
        <p className="text-[15px] text-text-secondary m-0">Token usage and request statistics over time.</p>
      </div>

      {/* All Charts in 4-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Time Series - Requests */}
        <Card className="min-w-0" title="Requests over Time">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                  }}
                  formatter={(value) => formatNumber(value as number)}
                />
                <Area type="monotone" dataKey="requests" stroke="var(--color-primary)" fill="var(--color-glow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Time Series - Tokens */}
        <Card className="min-w-0" title="Token Usage">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-glass)" />
                <XAxis dataKey="timestamp" stroke="var(--color-text-secondary)" />
                <YAxis stroke="var(--color-text-secondary)" tickFormatter={formatTokens} />
                <Tooltip
                  contentStyle={{
                      backgroundColor: 'var(--color-bg-card)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                  }}
                  formatter={(value) => formatTokens(value as number)}
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

        {/* Model Distribution - Requests */}
        <Card className="min-w-0" title="Usage by Model Alias (Requests)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', modelData)}
          </div>
        </Card>

        {/* Model Distribution - Tokens */}
        <Card className="min-w-0" title="Usage by Model Alias (Tokens)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('tokens', modelData)}
          </div>
        </Card>

        {/* Provider Distribution - Requests */}
        <Card className="min-w-0" title="Usage by Provider (Requests)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', providerData)}
          </div>
        </Card>

        {/* Provider Distribution - Tokens */}
        <Card className="min-w-0" title="Usage by Provider (Tokens)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('tokens', providerData)}
          </div>
        </Card>

        {/* API Key Distribution - Requests */}
        <Card className="min-w-0" title="Usage by API Key (Requests)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('requests', keyData)}
          </div>
        </Card>

        {/* API Key Distribution - Tokens */}
        <Card className="min-w-0" title="Usage by API Key (Tokens)">
          {renderTimeControls()}
          <div style={{ height: 300, marginTop: '12px' }}>
            {renderPieChart('tokens', keyData)}
          </div>
        </Card>
      </div>
    </div>
  );
};
