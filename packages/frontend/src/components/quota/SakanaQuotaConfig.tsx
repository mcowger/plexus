import React from 'react';

import { Input } from '../ui/Input';

export interface SakanaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const SakanaQuotaConfig: React.FC<SakanaQuotaConfigProps> = ({ options, onChange }) => {
  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="sakana-session-cookie"
          className="font-body text-text-secondary text-[13px] font-medium"
        >
          Session Cookie <span className="text-danger">*</span>
        </label>
        <Input
          id="sakana-session-cookie"
          type="password"
          value={(options.sessionCookie as string) ?? ''}
          onChange={(e) => handleChange('sessionCookie', e.target.value)}
          placeholder="Paste your __Secure-authjs.session-token cookie"
        />
        <span className="text-text-muted text-[10px]">
          Required. Found in browser DevTools (F12) → Application → Cookies → console.sakana.ai →
          copy the <span className="font-mono">__Secure-authjs.session-token</span> value. Treat it
          like a password — it expires and must be refreshed periodically.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="sakana-endpoint"
          className="font-body text-text-secondary text-[13px] font-medium"
        >
          Endpoint (optional)
        </label>
        <Input
          id="sakana-endpoint"
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://console.sakana.ai/billing"
        />
        <span className="text-text-muted text-[10px]">
          Custom billing page URL. Defaults to the standard Sakana billing console.
        </span>
      </div>
    </div>
  );
};
