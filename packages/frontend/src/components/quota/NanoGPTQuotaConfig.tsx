import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface NanoGPTQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NanoGPTQuotaConfig: React.FC<NanoGPTQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://nano-gpt.com/api/subscription/v1/usage"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.nanogpt.endpointHint')}</span>
      </div>
    </div>
  );
};
