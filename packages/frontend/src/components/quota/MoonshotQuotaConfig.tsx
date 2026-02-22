import React from 'react';
import { Input } from '../ui/Input';

export interface MoonshotQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const MoonshotQuotaConfig: React.FC<MoonshotQuotaConfigProps> = ({ options, onChange }) => {
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
          placeholder="https://api.moonshot.ai/v1/users/me/balance"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Moonshot API.
        </span>
      </div>
    </div>
  );
};
