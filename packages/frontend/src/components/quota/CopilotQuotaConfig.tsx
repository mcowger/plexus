import React from 'react';
import { Input } from '../ui/Input';
import { useT } from '../../i18n';

export interface CopilotQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const CopilotQuotaConfig: React.FC<CopilotQuotaConfigProps> = ({ options, onChange }) => {
  const { t } = useT('quotas');

  const handleChange = (key: string, value: string | number) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3" aria-label={t('checkerConfigs.copilot.formAriaLabel')}>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.github.com/copilot_internal/user"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.userAgentHeaderOptional')}
        </label>
        <Input
          value={(options.userAgent as string) ?? ''}
          onChange={(e) => handleChange('userAgent', e.target.value)}
          placeholder="GitHubCopilotChat/0.26.7"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.editorVersionOptional')}
        </label>
        <Input
          value={(options.editorVersion as string) ?? ''}
          onChange={(e) => handleChange('editorVersion', e.target.value)}
          placeholder="vscode/1.96.2"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.apiVersionOptional')}
        </label>
        <Input
          value={(options.apiVersion as string) ?? ''}
          onChange={(e) => handleChange('apiVersion', e.target.value)}
          placeholder="2025-04-01"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {t('checkerCommon.timeoutMsOptional')}
        </label>
        <Input
          type="number"
          value={(options.timeoutMs as number) ?? ''}
          onChange={(e) => handleChange('timeoutMs', parseInt(e.target.value, 10) || 15000)}
          placeholder="15000"
        />
      </div>
    </div>
  );
};
