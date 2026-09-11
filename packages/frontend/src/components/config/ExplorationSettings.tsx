import { Radar, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { Switch } from '../ui/Switch';
import type { BackgroundExplorationConfig, FieldValidation } from './types';

interface ExplorationSettingsProps {
  background: BackgroundExplorationConfig;
  saving: boolean;
  backgroundSaving: boolean;
  stalenessInput: string;
  concurrencyInput: string;
  performanceInput: string;
  latencyInput: string;
  e2eInput: string;
  stalenessValidation: FieldValidation;
  concurrencyValidation: FieldValidation;
  performanceValidation: FieldValidation;
  latencyValidation: FieldValidation;
  e2eValidation: FieldValidation;
  valid: boolean;
  onBackgroundEnabledChange: (enabled: boolean) => void;
  onStalenessChange: (value: string) => void;
  onConcurrencyChange: (value: string) => void;
  onPerformanceChange: (value: string) => void;
  onLatencyChange: (value: string) => void;
  onE2EChange: (value: string) => void;
  onSave: () => void;
}

export function ExplorationSettings({
  background,
  saving,
  backgroundSaving,
  stalenessInput,
  concurrencyInput,
  performanceInput,
  latencyInput,
  e2eInput,
  stalenessValidation,
  concurrencyValidation,
  performanceValidation,
  latencyValidation,
  e2eValidation,
  valid,
  onBackgroundEnabledChange,
  onStalenessChange,
  onConcurrencyChange,
  onPerformanceChange,
  onLatencyChange,
  onE2EChange,
  onSave,
}: ExplorationSettingsProps) {
  return (
    <Disclosure
      title="Exploration Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving || backgroundSaving}
          disabled={!valid}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Background exploration: master toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Radar size={16} className="text-primary" />
            <div>
              <p className="font-body text-[12px] font-medium text-text">Background Exploration</p>
              <p className="font-body text-[11px] text-text-muted">
                Fire background probe requests instead of diverting live traffic. Probes use
                apiKey="probe".
              </p>
            </div>
          </div>
          <Switch
            checked={background.enabled}
            onChange={onBackgroundEnabledChange}
            aria-label="Toggle background exploration on/off"
          />
        </div>

        {/* Background tunables — only rendered when background mode is on */}
        {background.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="bgExplorationStaleness"
                className="font-body text-[12px] font-medium text-text"
              >
                Staleness Threshold (s){' '}
                <span className="text-text-muted font-normal">— min 1, default 600</span>
              </label>
              <input
                id="bgExplorationStaleness"
                type="number"
                min={1}
                step={1}
                value={stalenessInput}
                onChange={(event) => onStalenessChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              {!stalenessValidation.valid && stalenessInput !== '' && (
                <span className="text-[11px] text-warning">{stalenessValidation.error}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="bgExplorationConcurrency"
                className="font-body text-[12px] font-medium text-text"
              >
                Worker Concurrency{' '}
                <span className="text-text-muted font-normal">— 1–16, default 2</span>
              </label>
              <input
                id="bgExplorationConcurrency"
                type="number"
                min={1}
                max={16}
                step={1}
                value={concurrencyInput}
                onChange={(event) => onConcurrencyChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              {!concurrencyValidation.valid && concurrencyInput !== '' && (
                <span className="text-[11px] text-warning">{concurrencyValidation.error}</span>
              )}
            </div>
          </div>
        )}

        {/* Inline rate tunables — only rendered when background mode is off */}
        {!background.enabled && (
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="performanceExplorationRate"
                className="font-body text-[12px] font-medium text-text"
              >
                Performance Rate{' '}
                <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
              </label>
              <input
                id="performanceExplorationRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={performanceInput}
                onChange={(event) => onPerformanceChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              {!performanceValidation.valid && performanceInput !== '' && (
                <span className="text-[11px] text-warning">{performanceValidation.error}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="latencyExplorationRate"
                className="font-body text-[12px] font-medium text-text"
              >
                Latency Rate{' '}
                <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
              </label>
              <input
                id="latencyExplorationRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={latencyInput}
                onChange={(event) => onLatencyChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              {!latencyValidation.valid && latencyInput !== '' && (
                <span className="text-[11px] text-warning">{latencyValidation.error}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="e2ePerformanceExplorationRate"
                className="font-body text-[12px] font-medium text-text"
              >
                E2E Rate <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
              </label>
              <input
                id="e2ePerformanceExplorationRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={e2eInput}
                onChange={(event) => onE2EChange(event.target.value)}
                className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
              />
              {!e2eValidation.valid && e2eInput !== '' && (
                <span className="text-[11px] text-warning">{e2eValidation.error}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
