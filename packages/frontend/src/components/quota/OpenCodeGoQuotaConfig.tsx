import React from 'react';
import { Input } from '../ui/Input';
import { ExternalLink } from 'lucide-react';

export interface OpenCodeGoQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OpenCodeGoQuotaConfig: React.FC<OpenCodeGoQuotaConfigProps> = ({
  options,
  onChange,
}) => {
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
          Workspace ID <span className="text-danger">*</span>
        </label>
        <Input
          id="opencode-go-workspace-id"
          value={(options.workspaceId as string) ?? ''}
          onChange={(e) => handleChange('workspaceId', e.target.value)}
          placeholder="Your OpenCode Go workspace ID"
        />
        <span className="text-[10px] text-text-muted">
          Required. Find it in your{' '}
          <a
            href="https://opencode.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            OpenCode dashboard <ExternalLink size={10} />
          </a>{' '}
          URL (e.g. opencode.ai/workspace/<span className="font-mono">your-id</span>/go).
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="opencode-go-auth-cookie"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          Auth Cookie <span className="text-danger">*</span>
        </label>
        <Input
          id="opencode-go-auth-cookie"
          type="password"
          value={(options.authCookie as string) ?? ''}
          onChange={(e) => handleChange('authCookie', e.target.value)}
          placeholder="Your OpenCode auth cookie value"
        />
        <span className="text-[10px] text-text-muted">
          Required. Open your browser's DevTools (F12) → Application/Storage → Cookies → opencode.ai
          → copy the <span className="font-mono">auth</span> cookie value. Treat it like a password.
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="opencode-go-endpoint"
          className="font-body text-[13px] font-medium text-text-secondary"
        >
          Endpoint (optional)
        </label>
        <Input
          id="opencode-go-endpoint"
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://opencode.ai/workspace/{id}/go"
        />
        <span className="text-[10px] text-text-muted">
          Custom dashboard URL. Defaults to the standard OpenCode Go dashboard.
        </span>
      </div>
    </div>
  );
};
