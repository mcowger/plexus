import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface OllamaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OllamaQuotaConfig: React.FC<OllamaQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.sessionCookie')} <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.sessionCookie as string) ?? ''}
          onChange={(e) => handleChange('sessionCookie', e.target.value)}
          placeholder={t('checkerConfigs.ollama.sessionCookiePlaceholder')}
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.ollama.sessionCookieHint')}</span>
      </div>
    </div>
  );
};
