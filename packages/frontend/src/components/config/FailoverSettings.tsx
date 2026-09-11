import { Save, Shield } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { Switch } from '../ui/Switch';
import type { FailoverPolicy } from './types';

interface FailoverSettingsProps {
  policy: FailoverPolicy;
  loaded: boolean;
  saving: boolean;
  statusCodesText: string;
  errorsText: string;
  onEnabledChange: (enabled: boolean) => void;
  onStatusCodesChange: (value: string) => void;
  onErrorsChange: (value: string) => void;
  onSave: () => void;
}

export function FailoverSettings({
  policy,
  loaded,
  saving,
  statusCodesText,
  errorsText,
  onEnabledChange,
  onStatusCodesChange,
  onErrorsChange,
  onSave,
}: FailoverSettingsProps) {
  return (
    <Disclosure
      title="Failover Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Enabled toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-primary" />
            <div>
              <p className="font-body text-[12px] font-medium text-text">Enable Failover</p>
              <p className="font-body text-[11px] text-text-muted">
                When enabled, failed requests are automatically retried on the next available
                provider.
              </p>
            </div>
          </div>
          <Switch
            checked={policy.enabled}
            onChange={onEnabledChange}
            aria-label="Toggle failover on/off"
          />
        </div>

        {/* Retryable Status Codes */}
        <div>
          <label
            htmlFor="retryableStatusCodes"
            className="font-body text-[12px] font-medium text-text"
          >
            Retryable Status Codes
          </label>
          <p className="text-xs text-text-muted mb-2">
            HTTP status codes that trigger a retry on the next provider. Enter comma-separated
            values (100–599). Defaults to all non-2xx codes except 413 and 422 when empty.
          </p>
          <textarea
            id="retryableStatusCodes"
            value={statusCodesText}
            onChange={(event) => onStatusCodesChange(event.target.value)}
            placeholder="e.g. 429, 500, 502, 503"
            rows={3}
            className="w-full py-1 px-2 font-mono text-[12px] text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted resize-y"
          />
        </div>

        {/* Retryable Errors */}
        <div>
          <label htmlFor="retryableErrors" className="font-body text-[12px] font-medium text-text">
            Retryable Network Errors
          </label>
          <p className="text-xs text-text-muted mb-2">
            Network error codes that trigger a retry on the next provider. Enter comma-separated
            values. Defaults to ECONNREFUSED, ETIMEDOUT, ENOTFOUND when empty.
          </p>
          <textarea
            id="retryableErrors"
            value={errorsText}
            onChange={(event) => onErrorsChange(event.target.value)}
            placeholder="e.g. ECONNREFUSED, ETIMEDOUT, ENOTFOUND"
            rows={2}
            className="w-full py-1 px-2 font-mono text-[12px] text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted resize-y"
          />
        </div>
      </div>
    </Disclosure>
  );
}
