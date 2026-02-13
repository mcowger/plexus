import React from 'react';
import { Button } from '../../../../components/ui/Button';

export type GroupBy = 'time' | 'provider' | 'model' | 'apiKey' | 'status';

interface GroupBySelectorProps {
  value: GroupBy;
  onChange: (groupBy: GroupBy) => void;
}

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'provider', label: 'Provider' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
];

export const GroupBySelector: React.FC<GroupBySelectorProps> = ({
  value,
  onChange
}) => {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-text-muted uppercase">Group By</span>
      <div className="flex gap-2">
        {GROUP_OPTIONS.map((option) => (
          <Button
            key={option.key}
            size="sm"
            variant={value === option.key ? 'primary' : 'secondary'}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
