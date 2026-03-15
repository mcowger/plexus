import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';

export interface ApertisCodingPlanQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ApertisCodingPlanQuotaConfig: React.FC<ApertisCodingPlanQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleChange = (key: string, value: string | number) => {
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
          placeholder="Enter your Apertis session cookie"
        />
        <span className="text-[10px] text-text-muted">
          Required. Get your session cookie from{' '}
          <a
            href="https://stima.tech"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Apertis Dashboard <ExternalLink size={10} />
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
          placeholder="https://api.stima.tech/api/subscription/status"
        />
        <span className="text-[10px] text-text-muted">
          Custom endpoint URL. Defaults to Apertis subscription status API.
        </span>
      </div>
    </div>
  );
};
