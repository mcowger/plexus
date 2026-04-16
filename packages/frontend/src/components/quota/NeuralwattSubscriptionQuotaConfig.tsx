import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';

export interface NeuralwattSubscriptionQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NeuralwattSubscriptionQuotaConfig: React.FC<
  NeuralwattSubscriptionQuotaConfigProps
> = ({ options, onChange }) => {
  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          API Key <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.apiKey as string) ?? ''}
          onChange={(e) => handleChange('apiKey', e.target.value)}
          placeholder="Enter your Neuralwatt API key"
        />
        <span className="text-[10px] text-text-muted">
          Required. Get your key from{' '}
          <a
            href="https://portal.neuralwatt.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Neuralwatt Portal <ExternalLink size={10} />
          </a>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.neuralwatt.com/v1/quota"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Neuralwatt&apos;s quota API.
        </span>
      </div>
    </div>
  );
};
