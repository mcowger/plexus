import React from 'react';
import { Input } from '../ui/Input';

export interface NovitaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NovitaQuotaConfig: React.FC<NovitaQuotaConfigProps> = ({ options, onChange }) => {
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
          placeholder="https://api.novita.ai/openapi/v1/billing/balance/detail"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Novita API.
        </span>
      </div>
    </div>
  );
};
