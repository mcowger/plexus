import React from 'react';
import { Input } from '../ui/Input';

export interface ExeDevQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ExeDevQuotaConfig: React.FC<ExeDevQuotaConfigProps> = ({ options, onChange }) => {
  const handleChange = (key: string, value: string | undefined) => {
    if (value !== undefined) {
      onChange({ ...options, [key]: value });
    } else {
      const { [key]: _, ...rest } = options;
      onChange(rest);
    }
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
          placeholder="https://exe.dev/exec"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to exe.dev&apos;s exec endpoint.
        </span>
      </div>
    </div>
  );
};
