import React from 'react';
import { Button } from '../../../../components/ui/Button';
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from 'lucide-react';

export type ChartType = 'line' | 'bar' | 'area' | 'pie';

interface ChartTypeSelectorProps {
  value: ChartType;
  onChange: (type: ChartType) => void;
  disabled?: boolean;
}

const CHART_TYPES: { key: ChartType; icon: React.ElementType; label: string }[] = [
  { key: 'area', icon: LineChartIcon, label: 'Area' },
  { key: 'line', icon: LineChartIcon, label: 'Line' },
  { key: 'bar', icon: BarChart3, label: 'Bar' },
  { key: 'pie', icon: PieChartIcon, label: 'Pie' },
];

export const ChartTypeSelector: React.FC<ChartTypeSelectorProps> = ({
  value,
  onChange,
  disabled = false
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-muted uppercase">Chart Type</span>
      <div className="flex gap-2">
        {CHART_TYPES.map((type) => (
          <Button
            key={type.key}
            size="sm"
            variant={value === type.key ? 'primary' : 'secondary'}
            onClick={() => onChange(type.key)}
            disabled={disabled && type.key !== 'pie'}
          >
            <type.icon size={16} className="mr-1" />
            {type.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
