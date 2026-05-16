import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';
import { useT } from '../../i18n';

export interface OpenCodeGoQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OpenCodeGoQuotaConfig: React.FC<OpenCodeGoQuotaConfigProps> = ({
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
        <label
          htmlFor="opencode-go-workspace-id"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          {t('checkerConfigs.opencode-go.workspaceId')} <span className="text-danger">*</span>
        </label>
        <Input
          id="opencode-go-workspace-id"
          value={(options.workspaceId as string) ?? ''}
          onChange={(e) => handleChange('workspaceId', e.target.value)}
          placeholder={t('checkerConfigs.opencode-go.workspacePlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          {t('checkerConfigs.opencode-go.workspaceHintPart1')}{' '}
          <a
            href="https://opencode.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            {t('checkerConfigs.opencode-go.workspaceHintLink')} <ExternalLink size={10} />
          </a>
          {t('checkerConfigs.opencode-go.workspaceHintPart2')}
          <span className="font-mono">{t('checkerConfigs.opencode-go.workspaceHintMono')}</span>
          {t('checkerConfigs.opencode-go.workspaceHintPart3')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="opencode-go-auth-cookie"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          {t('checkerConfigs.opencode-go.authCookie')} <span className="text-danger">*</span>
        </label>
        <Input
          id="opencode-go-auth-cookie"
          type="password"
          value={(options.authCookie as string) ?? ''}
          onChange={(e) => handleChange('authCookie', e.target.value)}
          placeholder={t('checkerConfigs.opencode-go.authCookiePlaceholder')}
        />
        <span className="text-[10px] text-text-muted">
          {t('checkerConfigs.opencode-go.authCookieHintBefore')}{' '}
          <span className="font-mono">{t('checkerConfigs.opencode-go.authCookieMono')}</span>
          {t('checkerConfigs.opencode-go.authCookieHintAfter')}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="opencode-go-endpoint"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          {t('checkerCommon.endpointOptional')}
        </label>
        <Input
          id="opencode-go-endpoint"
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://opencode.ai/workspace/{id}/go"
        />
        <span className="text-[10px] text-text-muted">{t('checkerConfigs.opencode-go.endpointHint')}</span>
      </div>
    </div>
  );
};
