import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { AlertTriangle } from 'lucide-react';
import type { Cooldown } from '../../lib/api';
import { formatMsToMinSec } from '@plexus/shared';

interface ServiceAlertsCardProps {
  cooldowns: Cooldown[];
  onClearAll: () => void;
}

export const ServiceAlertsCard: React.FC<ServiceAlertsCardProps> = ({ cooldowns, onClearAll }) => {
  const { t } = useTranslation();
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
      title={t('dashboard.cards.serviceAlerts.title')}
      className="alert-card"
      style={{ borderColor: 'var(--color-warning)' }}
      extra={
        <button
          className="bg-transparent text-text border-0 hover:bg-amber-500/10 py-1.5! px-3.5! text-xs!"
          onClick={onClearAll}
          style={{ color: 'var(--color-warning)' }}
        >
          {t('dashboard.cards.serviceAlerts.clearAll')}
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
          const modelDisplay = model || t('dashboard.cards.serviceAlerts.allModels');

          if (hasAccountId && modelCooldowns.length > 1) {
            statusText = t('dashboard.cards.serviceAlerts.statusMultipleAccounts', {
              model: modelDisplay,
              count: modelCooldowns.length,
              time: timeDisplay,
            });
          } else if (hasAccountId && modelCooldowns.length === 1) {
            statusText = t('dashboard.cards.serviceAlerts.statusSingleAccount', {
              model: modelDisplay,
              time: timeDisplay,
            });
          } else {
            statusText = t('dashboard.cards.serviceAlerts.statusModelCooldown', {
              model: modelDisplay,
              time: timeDisplay,
            });
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
