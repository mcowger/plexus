import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface KiloQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const KiloQuotaConfig: React.FC<KiloQuotaConfigProps> = ({ options, onChange }) => {
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
          placeholder="https://api.kilo.ai/api/profile/balance"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.organizationIdOptional')}
        </label>
        <Input
          value={(options.organizationId as string) ?? ''}
          onChange={(e) => handleChange('organizationId', e.target.value)}
          placeholder={t('checkerConfigs.kilo.orgIdPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.kilo.orgIdHint')}</span>
      </div>
    </div>
  );
};
