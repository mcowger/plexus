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
            className="glass-bg rounded-lg p-4 flex flex-col gap-1 transition-all duration-300"
          >
            <div className="flex justify-between items-start">
              <span className="font-body text-xs font-semibold text-text-muted uppercase tracking-wider">
                {metric.label}
              </span>
              <div
                className="w-8 h-8 rounded-sm flex items-center justify-center text-white"
                style={{ background: 'var(--color-bg-hover)' }}
              >
                {metric.icon}
              </div>
            </div>
            <div className="font-heading text-3xl font-bold text-text my-1">{metric.value}</div>
            {metric.subtitle && <div className="text-xs text-text-muted">{metric.subtitle}</div>}
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
