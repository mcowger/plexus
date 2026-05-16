import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';
import { useT } from '../../i18n';

export interface ZenmuxQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const ZenmuxQuotaConfig: React.FC<ZenmuxQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="zenmux-management-api-key"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          {t('checkerCommon.managementApiKey')} <span className="text-danger">*</span>
        </label>
        <Input
          id="zenmux-management-api-key"
          type="password"
          value={(options.managementApiKey as string) ?? ''}
          onChange={(e) => handleChange('managementApiKey', e.target.value)}
          placeholder={t('checkerConfigs.zenmux.managementKeyPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          {t('checkerConfigs.zenmux.managementKeyHintBefore')}{' '}
          <a
            href="https://zenmux.ai/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('checkerConfigs.zenmux.managementKeyLink')} <ExternalLink size={10} />
          </a>
          {t('checkerConfigs.zenmux.managementKeyHintAfter')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="zenmux-endpoint"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          id="zenmux-endpoint"
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://zenmux.ai/api/v1/management/subscription/detail"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.zenmux.endpointHint')}</span>
      </div>
    </div>
  );
};
