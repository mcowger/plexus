import React from 'react';
import { Card, CardContent } from '../../../../components/ui/shadcn-card';
import { formatNumber, formatTPS } from '../../../../lib/format';

interface ProviderHealthCardProps {
  provider: string;
  requests: number;
  errors: number;
  avgTokensPerSec: number;
}

export const ProviderHealthCard: React.FC<ProviderHealthCardProps> = ({
  provider,
  requests,
  errors,
  avgTokensPerSec
}) => {
  const errorRate = requests > 0 ? (errors / requests) * 100 : 0;
  const isHealthy = errorRate < 5;

  return (
    <Card className="hover:border-primary/50 transition-all">
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-3 h-3 rounded-full ${isHealthy ? 'bg-success animate-pulse' : 'bg-warning'}`} />
          <span className="font-semibold text-foreground">{provider}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-2xl font-bold text-foreground">{formatNumber(requests, 0)}</div>
            <div className="text-xs text-muted-foreground">requests</div>
          </div>
          <div>
            <div className="text-2xl font-bold" style={{ color: isHealthy ? '#10b981' : '#ef4444' }}>
              {formatTPS(avgTokensPerSec)}
            </div>
            <div className="text-xs text-muted-foreground">tok/s</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
