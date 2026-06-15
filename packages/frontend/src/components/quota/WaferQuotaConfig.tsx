import React from 'react';
import { Input } from '../ui/Input';
import { Switch } from '../ui/Switch';

export interface WaferQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const WaferQuotaConfig: React.FC<WaferQuotaConfigProps> = ({ options, onChange }) => {
  const includeAllowance = options.includeAllowance !== false;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => onChange({ ...options, endpoint: e.target.value })}
          placeholder="https://pass.wafer.ai/v1/inference/quota"
          disabled={!includeAllowance}
        />
        <span className="text-[10px] text-text-muted">Override the Wafer Pass quota endpoint.</span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="font-body text-[13px] font-medium text-text-secondary">
            Include Wafer Pass quota
          </label>
          <Switch
            size="sm"
            checked={includeAllowance}
            onChange={(checked) => onChange({ ...options, includeAllowance: checked })}
            aria-label="Include Wafer Pass allowance meter"
          />
        </div>
        <span className="text-[10px] text-text-muted">
          Disable if you only have a PAYG (serverless) account and not a Wafer Pass plan — prevents
          a zeroed-out quota meter from triggering unnecessary cooldowns.
        </span>
      </div>
    </div>
  );
};
