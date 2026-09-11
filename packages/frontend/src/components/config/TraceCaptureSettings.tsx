import { AlertTriangle } from 'lucide-react';
import { Disclosure } from '../ui/Disclosure';
import { Switch } from '../ui/Switch';

interface TraceCaptureSettingsProps {
  enabled: boolean;
  loaded: boolean;
  saving: boolean;
  onChange: (enabled: boolean) => void;
}

export function TraceCaptureSettings({
  enabled,
  loaded,
  saving,
  onChange,
}: TraceCaptureSettingsProps) {
  return (
    <Disclosure title="Trace Capture" defaultOpen={false}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-primary" />
          <div>
            <p className="font-body text-[12px] font-medium text-text">Capture Trace on Error</p>
            <p className="font-body text-[11px] text-text-muted">
              When enabled, debug traces are stored for requests that write to the inference error
              log or trigger a cooldown, even while global debug tracing is off.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onChange={onChange}
          disabled={!loaded || saving}
          aria-label="Toggle capture trace on error"
        />
      </div>
    </Disclosure>
  );
}
