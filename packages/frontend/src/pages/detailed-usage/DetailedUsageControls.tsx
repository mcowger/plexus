import {
  BarChart3,
  LineChart as LineChartIcon,
  List,
  PieChart as PieChartIcon,
} from 'lucide-react';
import { TimeRangeSelector } from '../../components/dashboard/TimeRangeSelector';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { CustomDateRange } from '../../lib/date';
import type { ChartType, GroupBy, MetricConfig, MetricKey, TimeRange, ViewMode } from './types';

interface DetailedUsageControlsProps {
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  customDateRange: CustomDateRange | null;
  onCustomRangeChange: (range: CustomDateRange | null) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  chartType: ChartType;
  onChartTypeChange: (chartType: ChartType) => void;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
  metrics: MetricConfig[];
  selectedMetrics: MetricKey[];
  onToggleMetric: (key: MetricKey) => void;
}

export const DetailedUsageControls = ({
  timeRange,
  onTimeRangeChange,
  customDateRange,
  onCustomRangeChange,
  groupBy,
  onGroupByChange,
  chartType,
  onChartTypeChange,
  viewMode,
  onViewModeChange,
  metrics,
  selectedMetrics,
  onToggleMetric,
}: DetailedUsageControlsProps) => (
  <Card className="mb-6" title="Chart Configuration">
    <div className="grid grid-cols-1 gap-4 lg:flex lg:flex-wrap">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-muted uppercase">Time Range</span>
        <TimeRangeSelector
          value={timeRange}
          onChange={(range) => {
            onTimeRangeChange(range);
            if (range !== 'custom') onCustomRangeChange(null);
          }}
          customRange={customDateRange}
          onCustomRangeChange={onCustomRangeChange}
          options={['live', 'hour', 'day', 'week', 'month', 'custom']}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-muted uppercase">Group By</span>
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'time', l: 'Time' },
            { k: 'provider', l: 'Provider' },
            { k: 'model', l: 'Model' },
            { k: 'apiKey', l: 'API key' },
            { k: 'status', l: 'Status' },
          ].map((option) => (
            <Button
              key={option.k}
              size="sm"
              variant={groupBy === option.k ? 'primary' : 'secondary'}
              onClick={() => onGroupByChange(option.k as GroupBy)}
            >
              {option.l}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-muted uppercase">Chart Type</span>
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'area', i: LineChartIcon, l: 'Area' },
            { k: 'line', i: LineChartIcon, l: 'Line' },
            { k: 'bar', i: BarChart3, l: 'Bar' },
            { k: 'composed', i: BarChart3, l: 'Mixed' },
            { k: 'pie', i: PieChartIcon, l: 'Pie' },
          ].map((chart) => (
            <Button
              key={chart.k}
              size="sm"
              variant={chartType === chart.k ? 'primary' : 'secondary'}
              onClick={() => onChartTypeChange(chart.k as ChartType)}
              disabled={groupBy !== 'time' && chart.k !== 'pie'}
            >
              <chart.i size={14} className="mr-1" />
              {chart.l}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-muted uppercase">View</span>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={viewMode === 'chart' ? 'primary' : 'secondary'}
            onClick={() => onViewModeChange('chart')}
          >
            <LineChartIcon size={14} className="mr-1" />
            Chart
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'list' ? 'primary' : 'secondary'}
            onClick={() => onViewModeChange('list')}
          >
            <List size={14} className="mr-1" />
            List
          </Button>
        </div>
      </div>

      {groupBy === 'time' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Metrics</span>
          <div className="flex gap-2 flex-wrap">
            {metrics.map((metric) => (
              <button
                key={metric.key}
                onClick={() => onToggleMetric(metric.key)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${selectedMetrics.includes(metric.key) ? 'bg-primary text-white' : 'bg-bg-hover text-text-secondary'}`}
              >
                {metric.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  </Card>
);
