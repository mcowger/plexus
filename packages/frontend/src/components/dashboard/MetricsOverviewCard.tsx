import React from 'react';

import { Card } from '../ui/Card';

export interface MetricItem {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;
}

interface MetricsOverviewCardProps {
  metrics: MetricItem[];
  title?: string;
}

export const MetricsOverviewCard: React.FC<MetricsOverviewCardProps> = ({
  metrics,
  title = 'Key Metrics',
}) => {
  return (
    <Card title={title}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: '16px',
        }}
      >
        {metrics.map((metric, index) => (
          <div
            key={index}
            className="glass-bg flex flex-col gap-1 rounded-lg p-4 transition-all duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="font-body text-text-muted text-xs font-semibold tracking-wider uppercase">
                {metric.label}
              </span>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-sm text-white"
                style={{ background: 'var(--color-bg-hover)' }}
              >
                {metric.icon}
              </div>
            </div>
            <div className="font-heading text-text my-1 text-3xl font-bold">{metric.value}</div>
            {metric.subtitle && <div className="text-text-muted text-xs">{metric.subtitle}</div>}
            {metric.trend !== undefined && (
              <div
                className={`text-sm leading-normal ${metric.trend > 0 ? 'text-success' : 'text-danger'}`}
              >
                {metric.trend > 0 ? '+' : ''}
                {metric.trend}% from last week
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};
