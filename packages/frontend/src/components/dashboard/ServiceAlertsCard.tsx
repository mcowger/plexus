import React from 'react';
import { Card } from '../ui/Card';
import { AlertTriangle } from 'lucide-react';
import type { Cooldown } from '../../lib/api';
import { formatMsToMinSec } from '@plexus/shared';

interface ServiceAlertsCardProps {
  cooldowns: Cooldown[];
  onClearAll: () => void;
}

export const ServiceAlertsCard: React.FC<ServiceAlertsCardProps> = ({ cooldowns, onClearAll }) => {
  if (cooldowns.length === 0) {
    return null;
  }

  // Group cooldowns by provider+model
  const groupedCooldowns = cooldowns.reduce(
    (acc, c) => {
      const key = `${c.provider}:${c.model}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(c);
      return acc;
    },
    {} as Record<string, Cooldown[]>
  );

  return (
    <Card
      title="Service Alerts"
      className="alert-card"
      style={{ borderColor: 'var(--color-warning)' }}
      extra={
        <button
          className="bg-transparent text-text border-0 hover:bg-amber-500/10 py-1.5! px-3.5! text-xs!"
          onClick={onClearAll}
          style={{ color: 'var(--color-warning)' }}
        >
          Clear All
        </button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Object.entries(groupedCooldowns).map(([key, modelCooldowns]) => {
          const [provider, model] = key.split(':');
          const hasAccountId = modelCooldowns.some((c) => c.accountId);
          const maxTime = Math.max(...modelCooldowns.map((c) => c.timeRemainingMs));
          const timeDisplay = formatMsToMinSec(maxTime);

          let statusText: string;
          const modelDisplay = model || 'all models';

          if (hasAccountId && modelCooldowns.length > 1) {
            statusText = `${modelDisplay} has ${modelCooldowns.length} accounts on cooldown for up to ${timeDisplay}`;
          } else if (hasAccountId && modelCooldowns.length === 1) {
            statusText = `${modelDisplay} has 1 account on cooldown for ${timeDisplay}`;
          } else {
            statusText = `${modelDisplay} is on cooldown for ${timeDisplay}`;
          }

          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                backgroundColor: 'rgba(255, 171, 0, 0.1)',
                borderRadius: '4px',
              }}
            >
              <AlertTriangle size={16} color="var(--color-warning)" />
              <span style={{ fontWeight: 500 }}>{provider}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{statusText}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
