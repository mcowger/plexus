import React from 'react';

export interface WisdomGateQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const WisdomGateQuotaConfig: React.FC<WisdomGateQuotaConfigProps> = () => (
  <span className="text-text-muted text-[10px]">
    Uses the provider's API key against https://api.wisgate.ai/v1/users/me/balance. No extra
    configuration needed.
  </span>
);
