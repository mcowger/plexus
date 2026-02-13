import React from 'react';
import { Input } from '../ui/Input';

export interface ZAIQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ZAIQuotaConfig: React.FC<ZAIQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleChange = (key: string, value: string) => {
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
          placeholder="https://api.z.ai/api/monitor/usage/quota/limit"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Z.AI's quota API.
        </span>
      </div>
    </div>
  );
};
