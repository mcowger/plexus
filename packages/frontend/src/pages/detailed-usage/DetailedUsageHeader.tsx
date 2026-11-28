import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
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
}: DetailedUsageHeaderProps) => {
  const actions = (
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
  );

  // Embedded in the Live modal, whose title already names this view.
  if (embedded) {
    return <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{actions}</div>;
  }

  return (
    <PageHeader
      title="Detailed Usage"
      subtitle="Advanced analytics with customizable chart types"
      actions={actions}
    />
  );
};
