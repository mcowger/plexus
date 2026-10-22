import React from 'react';

import { Input } from '../ui/Input';

export interface WisdomGateQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const WisdomGateQuotaConfig: React.FC<WisdomGateQuotaConfigProps> = ({
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
          Session Cookie <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.session as string) ?? ''}
          onChange={(e) => handleChange('session', e.target.value)}
          placeholder="Paste your Wisdom Gate session cookie"
        />
        <span className="text-text-muted text-[10px]">
          Required. Found in browser cookies after logging in to wisgate.ai.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://wisgate.ai/api/dashboard/billing/usage/details"
        />
        <span className="text-text-muted text-[10px]">
          Leave blank to use the default endpoint.
        </span>
      </div>
    </div>
  );
};
