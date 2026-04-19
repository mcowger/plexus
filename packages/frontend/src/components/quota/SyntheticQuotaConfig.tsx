import React from 'react';
import { Input } from '../ui/Input';

export interface SyntheticQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const SyntheticQuotaConfig: React.FC<SyntheticQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.synthetic.new/v2/quotas"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Synthetic's API.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Max Utilization Percent (optional)
        </label>
        <Input
          type="number"
          min={1}
          max={100}
          value={(options.maxUtilizationPercent as number) ?? ''}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            handleChange('maxUtilizationPercent', isNaN(parsed) ? undefined : parsed);
          }}
          placeholder="99"
        />
        <span className="text-[10px] text-text-muted">
          Threshold (1–100) to trigger cooldown. Default: 99. Set lower to reserve quota — e.g. 30 =
          provider cooled down at 30% usage, preserving 70%.
        </span>
      </div>
    </div>
  );
};
