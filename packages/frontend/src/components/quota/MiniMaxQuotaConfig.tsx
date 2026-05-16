import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface MiniMaxQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const MiniMaxQuotaConfig: React.FC<MiniMaxQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.groupId')} <span className="text-danger">*</span>
        </label>
        <Input
          value={(options.groupid as string) ?? ''}
          onChange={(e) => handleChange('groupid', e.target.value)}
          placeholder={t('checkerConfigs.minimax.groupIdPlaceholder')}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.hertzSessionCookie')} <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.hertzSession as string) ?? ''}
          onChange={(e) => handleChange('hertzSession', e.target.value)}
          placeholder={t('checkerConfigs.minimax.hertzSessionPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.minimax.hertzSessionHint')}</span>
      </div>
    </div>
  );
};
