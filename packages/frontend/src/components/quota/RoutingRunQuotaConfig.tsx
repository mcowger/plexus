import React from 'react';

import { Input } from '../ui/Input';

export interface RoutingRunQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const RoutingRunQuotaConfig: React.FC<RoutingRunQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleEndpointChange = (value: string) => {
    const next = { ...options };
    if (value.trim()) next.endpoint = value;
    else delete next.endpoint;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleEndpointChange(e.target.value)}
          placeholder="https://api.routing.run/v1/user/requests"
        />
        <span className="text-text-muted text-[10px]">
          Custom usage endpoint URL. Defaults to Routing.run /v1/user/requests.
        </span>
      </div>
    </div>
  );
};
