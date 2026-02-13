import React from 'react';
import { Input } from '../ui/Input';

export interface MiniMaxQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const MiniMaxQuotaConfig: React.FC<MiniMaxQuotaConfigProps> = ({
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
          Group ID <span className="text-danger">*</span>
        </label>
        <Input
          value={(options.groupid as string) ?? ''}
          onChange={(e) => handleChange('groupid', e.target.value)}
          placeholder="Enter MiniMax GroupId"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          HERTZ-SESSION Cookie <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.hertzSession as string) ?? ''}
          onChange={(e) => handleChange('hertzSession', e.target.value)}
          placeholder="Paste HERTZ-SESSION cookie value"
        />
        <span className="text-[10px] text-text-muted">
          Treated as a password. Used to query MiniMax balance.
        </span>
      </div>
    </div>
  );
};
