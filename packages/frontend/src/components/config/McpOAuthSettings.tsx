import { LockKeyhole, Save } from 'lucide-react';
import type { McpOAuthSettings as McpOAuthConfig } from '../../lib/api';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { Switch } from '../ui/Switch';
import type { FieldValidation } from './types';

interface McpOAuthSettingsProps {
  config: McpOAuthConfig;
  loaded: boolean;
  saving: boolean;
  issuerInput: string;
  issuerValidation: FieldValidation<boolean>;
  onEnabledChange: (enabled: boolean) => void;
  onIssuerChange: (value: string) => void;
  onSave: () => void;
}

export function McpOAuthSettings({
  config,
  loaded,
  saving,
  issuerInput,
  issuerValidation,
  onEnabledChange,
  onIssuerChange,
  onSave,
}: McpOAuthSettingsProps) {
  return (
    <Disclosure
      title="MCP OAuth"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded || !issuerValidation.valid}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <LockKeyhole size={16} className="text-primary" />
            <div>
              <p className="font-body text-[12px] font-medium text-text">
                Enable OAuth for MCP clients
              </p>
              <p className="font-body text-[11px] text-text-muted">
                Shared OAuth authorization for each configured MCP server.
              </p>
            </div>
          </div>
          <Switch
            checked={config.enabled}
            onChange={onEnabledChange}
            aria-label="Toggle MCP OAuth on/off"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcpOAuthIssuer" className="font-body text-[12px] font-medium text-text">
            External issuer URL
          </label>
          <input
            id="mcpOAuthIssuer"
            type="url"
            value={issuerInput}
            onChange={(event) => onIssuerChange(event.target.value)}
            placeholder="https://your-instance.example.com"
            className="w-full h-[32px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
          />
          {!issuerValidation.valid && (
            <span className="text-[11px] text-warning">{issuerValidation.error}</span>
          )}
          <p className="font-body text-[11px] text-text-muted leading-relaxed">
            Use the externally reachable URL for this Plexus instance, such as a Tailscale Funnel
            URL. Each MCP server derives its protected resource from this issuer, such as{' '}
            <code>/mcp/exa</code>. If this does not match the actual external URL, OAuth discovery
            metadata will point at the wrong origin and MCP connections can fail.
          </p>
        </div>
      </div>
    </Disclosure>
  );
}
