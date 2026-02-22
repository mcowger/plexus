import React from 'react';
import { Input } from '../ui/Input';

export interface MiniMaxCodingQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const MiniMaxCodingQuotaConfig: React.FC<MiniMaxCodingQuotaConfigProps> = ({
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
          placeholder="https://www.minimax.io/v1/api/openplatform/coding_plan/remains"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to MiniMax coding plan API.
        </span>
      </div>
    </div>
  );
};
