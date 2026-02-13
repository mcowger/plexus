import React from 'react';

export interface MetricConfig {
  key: string;
  label: string;
  color: string;
}

interface MetricToggleGroupProps {
  metrics: MetricConfig[];
  selected: string[];
  onToggle: (metricKey: string) => void;
}

export const MetricToggleGroup: React.FC<MetricToggleGroupProps> = ({
  metrics,
  selected,
  onToggle
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-muted uppercase">Metrics</span>
      <div className="flex gap-2 flex-wrap">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            onClick={() => onToggle(metric.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              selected.includes(metric.key)
                ? 'bg-primary text-white'
                : 'bg-bg-hover text-text-secondary hover:text-text'
            }`}
          >
            {metric.label}
          </button>
        ))}
      </div>
    </div>
  );
};
