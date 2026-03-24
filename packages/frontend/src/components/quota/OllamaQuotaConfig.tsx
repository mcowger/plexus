import React from 'react';
import { Input } from '../ui/Input';

export interface OllamaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OllamaQuotaConfig: React.FC<OllamaQuotaConfigProps> = ({ options, onChange }) => {
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
          value={(options.sessionCookie as string) ?? ''}
          onChange={(e) => handleChange('sessionCookie', e.target.value)}
          placeholder="Paste your Ollama __Secure-session cookie"
        />
        <span className="text-[10px] text-text-muted">
          Required. Found in browser cookies after logging in to ollama.com. The cookie name is
          __Secure-session (with double underscores).
        </span>
      </div>
    </div>
  );
};
