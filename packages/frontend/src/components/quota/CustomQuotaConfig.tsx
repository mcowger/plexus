import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { testCustomQuotaChecker } from '../../lib/api';
import { Button } from '../ui/Button';

interface Props {
  checkerId: string;
  provider: string;
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export function CustomQuotaConfig({ checkerId, provider, options, onChange }: Props) {
  const [optionsText, setOptionsText] = useState(JSON.stringify(options, null, 2));
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setOptionsText(JSON.stringify(options, null, 2));
  }, [options]);

  const updateOptions = (value: string) => {
    setOptionsText(value);
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed);
    } catch {
      // Wait for valid JSON before updating the provider form.
    }
  };

  const updateOption = (key: string, value: unknown) => {
    onChange({ ...options, [key]: value });
  };

  const endpoint = typeof options.endpoint === 'string' ? options.endpoint : '';
  const authHeader = typeof options.authHeader === 'string' ? options.authHeader : 'Authorization';
  const authPrefix = typeof options.authPrefix === 'string' ? options.authPrefix : 'Bearer';
  const useApiKey = options.useApiKey !== false;
  const configuredHeaders =
    options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)
      ? JSON.stringify(options.headers, null, 2)
      : '{}';

  const testChecker = async () => {
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await testCustomQuotaChecker(checkerId, provider, options);
      setTestMessage(`Success: ${result.meters.length} meter(s) returned.`);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-[11px] font-medium text-text-secondary">
          Request endpoint
          <input
            className="mt-1 h-8 w-full rounded-sm border border-border-glass bg-bg-glass px-2 text-xs text-text outline-none focus:border-primary"
            value={endpoint}
            onChange={(event) => updateOption('endpoint', event.target.value)}
            placeholder="https://provider.example.com/quota"
          />
        </label>
        <label className="text-[11px] font-medium text-text-secondary">
          Authentication header
          <input
            className="mt-1 h-8 w-full rounded-sm border border-border-glass bg-bg-glass px-2 text-xs text-text outline-none focus:border-primary"
            value={authHeader}
            onChange={(event) => updateOption('authHeader', event.target.value)}
            placeholder="Authorization"
          />
        </label>
        <label className="text-[11px] font-medium text-text-secondary">
          Authentication prefix
          <input
            className="mt-1 h-8 w-full rounded-sm border border-border-glass bg-bg-glass px-2 text-xs text-text outline-none focus:border-primary"
            value={authPrefix}
            onChange={(event) => updateOption('authPrefix', event.target.value)}
            placeholder="Bearer"
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[11px] text-text-secondary">
          <input
            type="checkbox"
            checked={useApiKey}
            onChange={(event) => updateOption('useApiKey', event.target.checked)}
          />
          Send the provider API key in this header
        </label>
      </div>
      <label className="text-[11px] font-medium text-text-secondary">
        Additional request headers (JSON)
        <textarea
          className="mt-1 min-h-20 w-full rounded-sm border border-border-glass bg-bg-glass p-2 font-mono text-[11px] text-text outline-none focus:border-primary"
          value={configuredHeaders}
          onChange={(event) => {
            try {
              const parsed = JSON.parse(event.target.value);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                onChange({ ...options, headers: parsed });
              }
            } catch {
              // Wait for valid JSON before updating the provider form.
            }
          }}
          spellCheck={false}
        />
      </label>
      <div>
        <label className="font-body text-[11px] font-medium text-text-secondary">
          Other options (JSON)
        </label>
        <textarea
          className="mt-1 min-h-28 w-full rounded-sm border border-border-glass bg-bg-glass p-2 font-mono text-[11px] text-text outline-none focus:border-primary"
          value={optionsText}
          onChange={(event) => updateOptions(event.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          isLoading={testing}
          onClick={testChecker}
          leftIcon={<Play size={13} />}
        >
          Test checker
        </Button>
        {testMessage && <span className="text-[11px] text-text-secondary">{testMessage}</span>}
      </div>
      <p className="m-0 text-[11px] italic text-text-secondary">
        In checker code, use ctx.fetch(url, init) to apply these settings automatically, or use
        ctx.requestHeaders() with the regular fetch function. The provider API key is inherited from
        the provider above and is never displayed here.
      </p>
    </div>
  );
}
