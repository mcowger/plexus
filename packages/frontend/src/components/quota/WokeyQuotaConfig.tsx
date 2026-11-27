import React from 'react';

import { Input } from '../ui/Input';

export interface WokeyQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const WokeyQuotaConfig: React.FC<WokeyQuotaConfigProps> = ({ options, onChange }) => {
  const handleEndpointChange = (value: string) => {
    const next = { ...options };
    if (value.trim()) next.endpoint = value;
    else delete next.endpoint;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleEndpointChange(e.target.value)}
          placeholder="https://api.wokey.ai/v1/dashboard/balance"
        />
        <span className="text-text-muted text-[10px]">
          Uses the provider's API key automatically. No additional configuration needed.
        </span>
      </div>
    </div>
  );
};
