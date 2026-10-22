import React from 'react';

import { Input } from '../ui/Input';

interface AntigravityQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const AntigravityQuotaConfig: React.FC<AntigravityQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => onChange({ ...options, endpoint: e.target.value })}
          placeholder="https://cloudcode-pa.googleapis.com"
        />
        <span className="text-text-muted text-[11px]">
          Override the Cloud Code endpoint. Leave blank to use the default with automatic sandbox
          fallback.
        </span>
      </div>
    </div>
  );
};
