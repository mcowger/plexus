import React from 'react';
import { Input } from '../ui/Input';

export interface DevPassQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const DevPassQuotaConfig: React.FC<DevPassQuotaConfigProps> = ({ options, onChange }) => {
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
          value={(options.session as string) ?? ''}
          onChange={(e) => handleChange('session', e.target.value)}
          placeholder="Paste your DevPass session cookie"
        />
        <span className="text-[10px] text-text-muted">
          Required. The cookie name is <code>__Secure-better-auth.session_token</code>.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://internal.llmgateway.io/dev-plans/status"
        />
        <span className="text-[10px] text-text-muted">
          Leave blank to use the default endpoint.
        </span>
      </div>
    </div>
  );
};
