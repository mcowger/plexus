import { Save } from 'lucide-react';

import type { CompactionSettings as CompactionConfig } from '../../lib/api';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { Switch } from '../ui/Switch';

interface CompactionSettingsProps {
  config: CompactionConfig;
  loaded: boolean;
  saving: boolean;
  onChange: (config: CompactionConfig) => void;
  onSave: () => void;
}

export function CompactionSettings({
  config,
  loaded,
  saving,
  onChange,
  onSave,
}: CompactionSettingsProps) {
  const update = (patch: Partial<CompactionConfig>) => onChange({ ...config, ...patch });

  return (
    <Disclosure
      title="Context Compaction"
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
        {/* enabled toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-body text-text text-[12px] font-medium">Enabled</p>
            <p className="font-body text-text-muted text-[11px]">
              Automatically compact context when the trigger threshold is reached.
            </p>
          </div>
          <Switch
            checked={config.enabled ?? false}
            onChange={(enabled) => update({ enabled })}
            aria-label="Toggle context compaction on/off"
          />
        </div>

        {/* strategy */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="compactionStrategy"
            className="font-body text-text text-[12px] font-medium"
          >
            Strategy
          </label>
          <select
            id="compactionStrategy"
            value={config.strategy ?? 'native'}
            onChange={(event) => update({ strategy: event.target.value as 'native' | 'headroom' })}
            className="text-text bg-bg-subtle border-border-glass focus:border-primary h-[27px] w-48 rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
          >
            <option value="native">native</option>
            <option value="headroom">headroom</option>
          </select>
        </div>

        {/* trigger ratio + absoluteTriggerTokens */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="compactionTriggerRatio"
              className="font-body text-text text-[12px] font-medium"
            >
              Trigger Ratio <span className="text-text-muted font-normal">— fraction 0–1</span>
            </label>
            <input
              id="compactionTriggerRatio"
              type="number"
              min={0}
              max={1}
              step={0.01}
              placeholder="e.g. 0.8"
              value={config.triggerRatio ?? ''}
              onChange={(event) => {
                const value = event.target.value === '' ? undefined : Number(event.target.value);
                update({ triggerRatio: value });
              }}
              className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="compactionAbsoluteTrigger"
              className="font-body text-text text-[12px] font-medium"
            >
              Absolute Trigger Tokens{' '}
              <span className="text-text-muted font-normal">— empty = off</span>
            </label>
            <input
              id="compactionAbsoluteTrigger"
              type="number"
              min={0}
              step={1}
              placeholder="Disabled"
              value={config.absoluteTriggerTokens ?? ''}
              onChange={(event) => {
                const value = event.target.value === '' ? null : Number(event.target.value);
                update({ absoluteTriggerTokens: value });
              }}
              className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="compactionMinTokens"
              className="font-body text-text text-[12px] font-medium"
            >
              Min Tokens
            </label>
            <input
              id="compactionMinTokens"
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 1000"
              value={config.minTokens ?? ''}
              onChange={(event) => {
                const value = event.target.value === '' ? undefined : Number(event.target.value);
                update({ minTokens: value });
              }}
              className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="compactionProtectRecent"
              className="font-body text-text text-[12px] font-medium"
            >
              Protect Recent (messages)
            </label>
            <input
              id="compactionProtectRecent"
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 4"
              value={config.protectRecent ?? ''}
              onChange={(event) => {
                const value = event.target.value === '' ? undefined : Number(event.target.value);
                update({ protectRecent: value });
              }}
              className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
            />
          </div>
        </div>

        {/* native sub-settings */}
        {config.strategy === 'native' && (
          <div className="flex flex-col gap-2">
            <p className="font-body text-text text-[12px] font-medium">Native Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="compactionNativeMaxArrayItems"
                  className="font-body text-text text-[12px] font-medium"
                >
                  Max Array Items
                </label>
                <input
                  id="compactionNativeMaxArrayItems"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="e.g. 20"
                  value={config.native?.maxArrayItems ?? ''}
                  onChange={(event) => {
                    const value =
                      event.target.value === '' ? undefined : Number(event.target.value);
                    update({ native: { ...config.native, maxArrayItems: value } });
                  }}
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="compactionNativeMaxStringChars"
                  className="font-body text-text text-[12px] font-medium"
                >
                  Max String Chars
                </label>
                <input
                  id="compactionNativeMaxStringChars"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="e.g. 500"
                  value={config.native?.maxStringChars ?? ''}
                  onChange={(event) => {
                    const value =
                      event.target.value === '' ? undefined : Number(event.target.value);
                    update({ native: { ...config.native, maxStringChars: value } });
                  }}
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* headroom sub-settings */}
        {config.strategy === 'headroom' && (
          <div className="flex flex-col gap-2">
            <p className="font-body text-text text-[12px] font-medium">Headroom Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1">
                <label
                  htmlFor="compactionHeadroomBaseUrl"
                  className="font-body text-text text-[12px] font-medium"
                >
                  Base URL
                </label>
                <input
                  id="compactionHeadroomBaseUrl"
                  type="text"
                  placeholder="http://localhost:8787"
                  value={config.headroom?.baseUrl ?? ''}
                  onChange={(event) =>
                    update({
                      headroom: {
                        ...config.headroom,
                        baseUrl: event.target.value || undefined,
                      },
                    })
                  }
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label
                  htmlFor="compactionHeadroomApiKey"
                  className="font-body text-text text-[12px] font-medium"
                >
                  API Key
                </label>
                <input
                  id="compactionHeadroomApiKey"
                  type="password"
                  placeholder="••••••••"
                  value={config.headroom?.apiKey ?? ''}
                  onChange={(event) =>
                    update({
                      headroom: {
                        ...config.headroom,
                        apiKey: event.target.value || undefined,
                      },
                    })
                  }
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="compactionHeadroomTargetRatio"
                  className="font-body text-text text-[12px] font-medium"
                >
                  Target Ratio{' '}
                  <span className="text-text-muted font-normal">— 0–1, empty = off</span>
                </label>
                <input
                  id="compactionHeadroomTargetRatio"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  placeholder="Disabled"
                  value={config.headroom?.targetRatio ?? ''}
                  onChange={(event) => {
                    const value = event.target.value === '' ? null : Number(event.target.value);
                    update({ headroom: { ...config.headroom, targetRatio: value } });
                  }}
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="compactionHeadroomTimeoutMs"
                  className="font-body text-text text-[12px] font-medium"
                >
                  Timeout (ms)
                </label>
                <input
                  id="compactionHeadroomTimeoutMs"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="e.g. 30000"
                  value={config.headroom?.timeoutMs ?? ''}
                  onChange={(event) => {
                    const value =
                      event.target.value === '' ? undefined : Number(event.target.value);
                    update({ headroom: { ...config.headroom, timeoutMs: value } });
                  }}
                  className="text-text bg-bg-subtle border-border-glass focus:border-primary placeholder:text-text-muted h-[27px] w-full rounded-sm border px-2 py-0 font-mono text-[12px] leading-none outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
