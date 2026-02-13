import React from 'react';
import { Button } from '../../../../components/ui/Button';

export type TimeRange = 'hour' | 'day' | 'week' | 'month';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: 'hour', label: 'Hour' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  value,
  onChange
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-muted uppercase">Time Range</span>
      <div className="flex gap-2">
        {TIME_RANGES.map((range) => (
          <Button
            key={range.key}
            size="sm"
            variant={value === range.key ? 'primary' : 'secondary'}
            onClick={() => onChange(range.key)}
          >
            {range.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
