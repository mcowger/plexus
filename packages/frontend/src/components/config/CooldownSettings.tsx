import { Save } from 'lucide-react';
import { formatMinutesToMinSec } from '@plexus/shared';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import type { CooldownPolicy, FieldValidation } from './types';

interface CooldownSettingsProps {
  policy: CooldownPolicy;
  loaded: boolean;
  saving: boolean;
  initialInput: string;
  maxInput: string;
  initialValidation: FieldValidation;
  maxValidation: FieldValidation;
  onInitialChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  onSave: () => void;
}

export function CooldownSettings({
  policy,
  loaded,
  saving,
  initialInput,
  maxInput,
  initialValidation,
  maxValidation,
  onInitialChange,
  onMaxChange,
  onSave,
}: CooldownSettingsProps) {
  return (
    <Disclosure
      title="Cooldown Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded || !initialValidation.valid || !maxValidation.valid}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Initial + Max in 2-col grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="cooldownInitialMinutes"
              className="font-body text-[12px] font-medium text-text"
            >
              Initial Cooldown (min){' '}
              <span className="text-text-muted font-normal">— C₀, first failure</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="cooldownInitialMinutes"
                type="number"
                min={0.1}
                step={0.1}
                value={initialInput}
                onChange={(event) => onInitialChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">
                {initialValidation.valid && initialValidation.value != null
                  ? formatMinutesToMinSec(initialValidation.value)
                  : loaded
                    ? formatMinutesToMinSec(policy.initialMinutes)
                    : '—'}
              </span>
            </div>
            {!initialValidation.valid && initialInput !== '' && (
              <span className="text-[11px] text-warning">{initialValidation.error}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="cooldownMaxMinutes"
              className="font-body text-[12px] font-medium text-text"
            >
              Maximum Cooldown (min){' '}
              <span className="text-text-muted font-normal">— C_max, upper limit</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="cooldownMaxMinutes"
                type="number"
                min={0.1}
                step={0.1}
                value={maxInput}
                onChange={(event) => onMaxChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">
                {maxValidation.valid && maxValidation.value != null
                  ? formatMinutesToMinSec(maxValidation.value)
                  : loaded
                    ? formatMinutesToMinSec(policy.maxMinutes)
                    : '—'}
              </span>
            </div>
            {!maxValidation.valid && maxInput !== '' && (
              <span className="text-[11px] text-warning">{maxValidation.error}</span>
            )}
          </div>
        </div>
      </div>
    </Disclosure>
  );
}
