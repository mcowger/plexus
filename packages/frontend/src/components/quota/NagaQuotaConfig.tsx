import { ExternalLink } from 'lucide-react';
import React from 'react';

import { Input } from '../ui/Input';

export interface NagaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NagaQuotaConfig: React.FC<NagaQuotaConfigProps> = ({ options, onChange }) => {
  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Provisioning API Key <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.apiKey as string) ?? ''}
          onChange={(e) => handleChange('apiKey', e.target.value)}
          placeholder="Enter your Naga provisioning key"
        />
        <span className="text-text-muted text-[10px]">
          Required. Use a provisioning key from{' '}
          <a
            href="https://naga.ac/dashboard/provisioning-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            Naga Dashboard <ExternalLink size={10} />
          </a>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.naga.ac/v1/account/balance"
        />
        <span className="text-text-muted text-[10px]">
          Custom endpoint URL. Defaults to Naga's API.
        </span>
      </div>
    </div>
  );
};
