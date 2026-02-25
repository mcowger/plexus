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
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => onChange({ ...options, endpoint: e.target.value })}
          placeholder="https://wisdom-gate.juheapi.com/v1/users/me/balance"
        />
        <span className="text-[10px] text-text-muted">
          Leave blank to use the default endpoint. API key is inherited from the provider.
        </span>
      </div>
    </div>
  );
};
