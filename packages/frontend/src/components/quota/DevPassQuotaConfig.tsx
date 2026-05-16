import React from 'react';
import { Input } from '../ui/Input';
import { Trans } from 'react-i18next';
import { useT } from '../../i18n';

export interface DevPassQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const DevPassQuotaConfig: React.FC<DevPassQuotaConfigProps> = ({ options, onChange }) => {
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
          value={(options.session as string) ?? ''}
          onChange={(e) => handleChange('session', e.target.value)}
          placeholder={t('checkerConfigs.devpass.sessionPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          <Trans
            i18nKey="quotas.checkerConfigs.devpass.sessionHint"
            components={{
              1: <code />,
            }}
          />
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://internal.llmgateway.io/dev-plans/status"
        />
        <span className="text-[10px] text-text-muted">{t('checkerCommon.leaveBlankDefaultEndpoint')}</span>
      </div>
    </div>
  );
};
