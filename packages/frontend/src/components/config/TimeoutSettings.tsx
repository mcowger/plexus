import { Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import type { FieldValidation, TimeoutConfig } from './types';

interface TimeoutSettingsProps {
  config: TimeoutConfig;
  loaded: boolean;
  saving: boolean;
  defaultInput: string;
  validation: FieldValidation;
  onDefaultChange: (value: string) => void;
  onSave: () => void;
}

function formatTimeout(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function TimeoutSettings({
  config,
  loaded,
  saving,
  defaultInput,
  validation,
  onDefaultChange,
  onSave,
}: TimeoutSettingsProps) {
  return (
    <Disclosure
      title="Timeout Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded || !validation.valid}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="timeoutDefaultSeconds"
            className="font-body text-[12px] font-medium text-text"
          >
            Default Timeout (seconds){' '}
            <span className="text-text-muted font-normal">— global default, 1–3600s</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="timeoutDefaultSeconds"
              type="number"
              min={1}
              max={3600}
              step={1}
              value={defaultInput}
              onChange={(event) => onDefaultChange(event.target.value)}
              className="w-48 h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            <span className="text-[11px] text-text-muted tabular-nums">
              {validation.valid && validation.value != null
                ? formatTimeout(validation.value)
                : loaded
                  ? formatTimeout(config.defaultSeconds)
                  : '—'}
            </span>
          </div>
          {!validation.valid && defaultInput !== '' && (
            <span className="text-[11px] text-warning">{validation.error}</span>
          )}
        </div>
      </div>
    </Disclosure>
  );
}
