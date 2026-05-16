import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';
import { useT } from '../../i18n';

export interface OpenRouterQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OpenRouterQuotaConfig: React.FC<OpenRouterQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.managementApiKey')} <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.apiKey as string) ?? ''}
          onChange={(e) => handleChange('apiKey', e.target.value)}
          placeholder={t('checkerConfigs.openrouter.managementKeyPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          {t('checkerConfigs.openrouter.managementKeyHintBefore')}{' '}
          <a
            href="https://openrouter.ai/settings/management-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('checkerConfigs.openrouter.managementKeyLink')} <ExternalLink size={10} />
          </a>
          {t('checkerConfigs.openrouter.managementKeyHintAfter')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://openrouter.ai/api/v1/credits"
        />
      </div>
    </div>
  );
};
