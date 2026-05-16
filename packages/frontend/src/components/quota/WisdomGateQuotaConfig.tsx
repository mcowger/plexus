import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface WisdomGateQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const WisdomGateQuotaConfig: React.FC<WisdomGateQuotaConfigProps> = ({
  options,
  onChange,
}) => {
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
          placeholder={t('checkerConfigs.wisdomgate.sessionPlaceholder')}
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.wisdomgate.sessionHint')}</span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://wisgate.ai/api/dashboard/billing/usage/details"
        />
        <span className="text-[10px] text-text-muted">{t('checkerCommon.leaveBlankDefaultEndpoint')}</span>
      </div>
    </div>
  );
};
