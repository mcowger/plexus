import React from 'react';

import { Input } from '../ui/Input';

export interface NeuralwattQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NeuralwattQuotaConfig: React.FC<NeuralwattQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.neuralwatt.com/v1/quota"
        />
        <span className="text-text-muted text-[10px]">
          Uses the provider's API key automatically. No additional configuration needed.
        </span>
      </div>
    </div>
  );
};
