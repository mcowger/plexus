import React from 'react';
import { Badge } from '../../../../components/ui/shadcn-badge';
import { formatNumber } from '../../../../lib/format';

interface DigitalCounterProps {
  value: number;
  label: string;
  color?: string;
}

const getVariantFromColor = (color: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (color) {
    case '#10b981':
    case 'green':
      return 'secondary';
    case '#ef4444':
    case 'red':
      return 'destructive';
    case '#3b82f6':
    case 'blue':
    default:
      return 'default';
  }
};

export const DigitalCounter: React.FC<DigitalCounterProps> = ({
  value,
  label,
  color = '#3b82f6'
}) => {
  const variant = getVariantFromColor(color);

  return (
    <div className="flex flex-col items-center">
      <Badge
        variant={variant}
        className="text-4xl font-black px-4 py-2"
      >
        {formatNumber(value, 0)}
      </Badge>
      <div className="text-sm text-muted-foreground uppercase tracking-widest mt-2">{label}</div>
    </div>
  );
};
