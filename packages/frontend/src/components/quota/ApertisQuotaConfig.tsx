import React from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useT } from '../../i18n';

export interface ApertisQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ApertisQuotaConfig: React.FC<ApertisQuotaConfigProps> = ({ options, onChange }) => {
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
          placeholder="https://api.apertis.ai/v1/dashboard/billing/credits"
        />
        <span className="text-[10px] text-text-muted">{t('checkerCommon.usesProviderApiKeyAuto')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.quotaSource')}
        </label>
        <Select
          value={(options.mode as string) ?? 'subscription'}
          onChange={(val) => onChange({ ...options, mode: val })}
          options={[
            { value: 'subscription', label: t('checkerCommon.modeSubscription') },
            { value: 'payg', label: t('checkerCommon.modePayg') },
          ]}
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.apertis.modeHint')}</span>
      </div>
    </div>
  );
};
