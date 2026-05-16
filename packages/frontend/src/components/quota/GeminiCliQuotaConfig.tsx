import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

interface GeminiCliQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const GeminiCliQuotaConfig: React.FC<GeminiCliQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3" aria-label={t('checkerConfigs.gemini-cli.formAriaLabel')}>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.userAgentOptional')}
        </label>
        <Input
          value={(options.userAgent as string) ?? ''}
          onChange={(e) => handleChange('userAgent', e.target.value)}
          placeholder="google-api-nodejs-client/10.3.0"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.googApiClientOptional')}
        </label>
        <Input
          value={(options.googApiClient as string) ?? ''}
          onChange={(e) => handleChange('googApiClient', e.target.value)}
          placeholder="gl-node/22.18.0"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.clientMetadataOptional')}
        </label>
        <Input
          value={(options.clientMetadata as string) ?? ''}
          onChange={(e) => handleChange('clientMetadata', e.target.value)}
          placeholder="ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI"
        />
      </div>
    </div>
  );
};
