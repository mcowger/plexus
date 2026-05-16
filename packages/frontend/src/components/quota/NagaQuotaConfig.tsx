import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';
import { useT } from '../../i18n';

export interface NagaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NagaQuotaConfig: React.FC<NagaQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerConfigs.naga.provisioningApiKey')} <span className="text-danger">*</span>
        </label>
        <Input
          type="password"
          value={(options.apiKey as string) ?? ''}
          onChange={(e) => handleChange('apiKey', e.target.value)}
          placeholder={t('checkerConfigs.naga.provisioningKeyPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          {t('checkerConfigs.naga.provisioningKeyHintBefore')}{' '}
          <a
            href="https://naga.ac/dashboard/provisioning-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('checkerConfigs.naga.provisioningKeyLink')} <ExternalLink size={10} />
          </a>
          {t('checkerConfigs.naga.provisioningKeyHintAfter')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.naga.ac/v1/account/balance"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.naga.endpointHint')}</span>
      </div>
    </div>
  );
};
