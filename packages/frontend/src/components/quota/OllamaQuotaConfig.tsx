import React from 'react';

import { Switch } from '../ui/Switch';

export interface OllamaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OllamaQuotaConfig: React.FC<OllamaQuotaConfigProps> = ({ options, onChange }) => (
  <div className="space-y-3">
    <p className="text-text-muted text-[10px]">
      Uses the API key configured for this provider to read your Ollama balance.
    </p>
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-body text-text-secondary text-[13px] font-medium">
          Use purchased credits
        </span>
        <span className="text-text-muted text-[10px]">
          Ollama bills purchased credits once your plan allowance runs out. Enable this to keep
          routing while credits remain. When off, an exhausted session, weekly, or monthly allowance
          triggers a cooldown even if you have credits.
        </span>
      </div>
      <Switch
        aria-label="Use purchased credits"
        checked={options.usePurchasedCredits === true}
        onChange={(checked) => onChange({ ...options, usePurchasedCredits: checked })}
      />
    </div>
  </div>
);
