import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface PoeQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const PoeQuotaConfig: React.FC<PoeQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3" aria-label={t('checkerConfigs.poe.formAriaLabel')}>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.poe.com/usage/current_balance"
        />
      </div>
    </div>
  );
};
