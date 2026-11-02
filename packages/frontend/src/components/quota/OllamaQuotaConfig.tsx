import React from 'react';

export interface OllamaQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const OllamaQuotaConfig: React.FC<OllamaQuotaConfigProps> = () => (
  <p className="text-text-muted text-[10px]">
    Uses the API key configured for this provider to read your Ollama balance.
  </p>
);
