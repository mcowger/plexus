import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface SyntheticQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const SyntheticQuotaConfig: React.FC<SyntheticQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string | number | undefined) => {
    if (value !== undefined) {
      onChange({ ...options, [key]: value });
    } else {
      const { [key]: _, ...rest } = options;
      onChange(rest);
    }
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
          placeholder="https://api.synthetic.new/v2/quotas"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.synthetic.endpointHint')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.maxUtilizationPercentOptional')}
        </label>
        <Input
          type="number"
          min={1}
          max={100}
          value={(options.maxUtilizationPercent as number) ?? ''}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            handleChange('maxUtilizationPercent', isNaN(parsed) ? undefined : parsed);
          }}
          placeholder="99"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.synthetic.maxUtilizationHint')}</span>
      </div>
    </div>
  );
};
