import React from 'react';
import { Input } from '../ui/Input';

export interface ApertisCodingPlanQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ApertisCodingPlanQuotaConfig: React.FC<ApertisCodingPlanQuotaConfigProps> = ({
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
          placeholder="https://api.apertis.ai/v1/dashboard/billing/credits"
        />
        <span className="text-[10px] text-text-muted">
          Uses the provider's API key automatically. Requires an active subscription plan.
        </span>
      </div>
    </div>
  );
};
