import { ArrowLeft } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/layout/PageHeader';
import { formatTimeAgo } from '../../lib/format';

interface DetailedUsageHeaderProps {
  embedded: boolean;
  onBack?: () => void;
  lastUpdated: Date;
}

export const DetailedUsageHeader = ({
  embedded,
  onBack,
  lastUpdated,
}: DetailedUsageHeaderProps) => (
  <PageHeader
    title="Detailed Usage"
    subtitle="Advanced analytics with customizable chart types"
    actions={
      <>
        {(onBack || !embedded) && (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<ArrowLeft size={16} />}
            onClick={() => (onBack ? onBack() : (window.location.href = '/ui/live-metrics'))}
          >
            {onBack ? 'Back to Live Card' : 'Return to Live Metrics'}
          </Button>
        )}
        <Badge
          status="connected"
          secondaryText={`Last updated: ${formatTimeAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))}`}
        >
          Live Data
        </Badge>
      </>
    }
  />
);
