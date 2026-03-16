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
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Session Cookie <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.apiKey as string) ?? ''}
          onChange={(e) => handleChange('apiKey', e.target.value)}
          placeholder="Paste your Wisdom Gate session cookie"
        />
        <span className="text-[10px] text-text-muted">
          Required. The session cookie from your Wisdom Gate account.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://wisdom-gate.juheapi.com/v1/users/me/balance"
        />
        <span className="text-[10px] text-text-muted">
          Leave blank to use the default endpoint.
        </span>
      </div>
    </div>
  );
};
