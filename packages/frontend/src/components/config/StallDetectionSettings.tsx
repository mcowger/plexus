import { Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import type { FieldValidation } from './types';

interface StallDetectionSettingsProps {
  loaded: boolean;
  saving: boolean;
  ttfbInput: string;
  ttfbBytesInput: string;
  minBpsInput: string;
  windowInput: string;
  graceInput: string;
  ttfbValidation: FieldValidation<number | null>;
  ttfbBytesValidation: FieldValidation;
  minBpsValidation: FieldValidation<number | null>;
  windowValidation: FieldValidation;
  graceValidation: FieldValidation;
  onTtfbChange: (value: string) => void;
  onTtfbBytesChange: (value: string) => void;
  onMinBpsChange: (value: string) => void;
  onWindowChange: (value: string) => void;
  onGraceChange: (value: string) => void;
  onSave: () => void;
}

export function StallDetectionSettings({
  loaded,
  saving,
  ttfbInput,
  ttfbBytesInput,
  minBpsInput,
  windowInput,
  graceInput,
  ttfbValidation,
  ttfbBytesValidation,
  minBpsValidation,
  windowValidation,
  graceValidation,
  onTtfbChange,
  onTtfbBytesChange,
  onMinBpsChange,
  onWindowChange,
  onGraceChange,
  onSave,
}: StallDetectionSettingsProps) {
  const isValid =
    loaded &&
    ttfbValidation.valid &&
    ttfbBytesValidation.valid &&
    minBpsValidation.valid &&
    windowValidation.valid &&
    graceValidation.valid;

  return (
    <Disclosure
      title="Stall Detection"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!isValid}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="stallTtfbSeconds"
              className="font-body text-[12px] font-medium text-text"
            >
              TTFB Timeout (s){' '}
              <span className="text-text-muted font-normal">— 5–120, empty = off</span>
            </label>
            <input
              id="stallTtfbSeconds"
              type="number"
              min={5}
              max={120}
              step={1}
              placeholder="Disabled"
              value={ttfbInput}
              onChange={(event) => onTtfbChange(event.target.value)}
              className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            {!ttfbValidation.valid && ttfbInput !== '' && (
              <span className="text-[11px] text-warning">{ttfbValidation.error}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="stallTtfbBytes" className="font-body text-[12px] font-medium text-text">
              TTFB Byte Threshold <span className="text-text-muted font-normal">— 50–10,000</span>
            </label>
            <input
              id="stallTtfbBytes"
              type="number"
              min={50}
              max={10000}
              step={1}
              value={ttfbBytesInput}
              onChange={(event) => onTtfbBytesChange(event.target.value)}
              className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            {!ttfbBytesValidation.valid && ttfbBytesInput !== '' && (
              <span className="text-[11px] text-warning">{ttfbBytesValidation.error}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="stallMinBps" className="font-body text-[12px] font-medium text-text">
              Min Bytes/sec{' '}
              <span className="text-text-muted font-normal">— 50–5,000, empty = off</span>
            </label>
            <input
              id="stallMinBps"
              type="number"
              min={50}
              max={5000}
              step={1}
              placeholder="Disabled"
              value={minBpsInput}
              onChange={(event) => onMinBpsChange(event.target.value)}
              className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            {!minBpsValidation.valid && minBpsInput !== '' && (
              <span className="text-[11px] text-warning">{minBpsValidation.error}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="stallWindowSeconds"
              className="font-body text-[12px] font-medium text-text"
            >
              Sliding Window (s) <span className="text-text-muted font-normal">— 3–30</span>
            </label>
            <input
              id="stallWindowSeconds"
              type="number"
              min={3}
              max={30}
              step={1}
              value={windowInput}
              onChange={(event) => onWindowChange(event.target.value)}
              className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            {!windowValidation.valid && windowInput !== '' && (
              <span className="text-[11px] text-warning">{windowValidation.error}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="stallGraceSeconds"
              className="font-body text-[12px] font-medium text-text"
            >
              Grace Period (s){' '}
              <span className="text-text-muted font-normal">— 0–120, post-TTFB pause</span>
            </label>
            <input
              id="stallGraceSeconds"
              type="number"
              min={0}
              max={120}
              step={1}
              value={graceInput}
              onChange={(event) => onGraceChange(event.target.value)}
              className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
            />
            {!graceValidation.valid && graceInput !== '' && (
              <span className="text-[11px] text-warning">{graceValidation.error}</span>
            )}
          </div>
        </div>
      </div>
    </Disclosure>
  );
}
