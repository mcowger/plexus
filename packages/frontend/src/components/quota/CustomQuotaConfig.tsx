import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';

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
        <label className="text-text-secondary text-[11px] font-medium">
          Request endpoint
          <input
            className="border-border-glass bg-bg-glass text-text focus:border-primary mt-1 h-8 w-full rounded-sm border px-2 text-xs outline-none"
            value={endpoint}
            onChange={(event) => updateOption('endpoint', event.target.value)}
            placeholder="https://provider.example.com/quota"
          />
        </label>
        <label className="text-text-secondary text-[11px] font-medium">
          Authentication header
          <input
            className="border-border-glass bg-bg-glass text-text focus:border-primary mt-1 h-8 w-full rounded-sm border px-2 text-xs outline-none"
            value={authHeader}
            onChange={(event) => updateOption('authHeader', event.target.value)}
            placeholder="Authorization"
          />
        </label>
        <label className="text-text-secondary text-[11px] font-medium">
          Authentication prefix
          <input
            className="border-border-glass bg-bg-glass text-text focus:border-primary mt-1 h-8 w-full rounded-sm border px-2 text-xs outline-none"
            value={authPrefix}
            onChange={(event) => updateOption('authPrefix', event.target.value)}
            placeholder="Bearer"
          />
        </label>
        <label className="text-text-secondary flex items-center gap-2 self-end pb-2 text-[11px]">
          <input
            type="checkbox"
            checked={useApiKey}
            onChange={(event) => updateOption('useApiKey', event.target.checked)}
          />
          Send the provider API key in this header
        </label>
      </div>
      <label className="text-text-secondary text-[11px] font-medium">
        Additional request headers (JSON)
        <textarea
          className="border-border-glass bg-bg-glass text-text focus:border-primary mt-1 min-h-20 w-full rounded-sm border p-2 font-mono text-[11px] outline-none"
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
        <label className="font-body text-text-secondary text-[11px] font-medium">
          Other options (JSON)
        </label>
        <textarea
          className="border-border-glass bg-bg-glass text-text focus:border-primary mt-1 min-h-28 w-full rounded-sm border p-2 font-mono text-[11px] outline-none"
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
        {testMessage && <span className="text-text-secondary text-[11px]">{testMessage}</span>}
      </div>
      <p className="text-text-secondary m-0 text-[11px] italic">
        In checker code, use ctx.fetch(url, init) to apply these settings automatically, or use
        ctx.requestHeaders() with the regular fetch function. The provider API key is inherited from
        the provider above and is never displayed here.
      </p>
    </div>
  );
}
