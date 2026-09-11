import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface ModelMetadataCardProps {
  loading: boolean;
  onRefresh: () => void;
}

export function ModelMetadataCard({ loading, onRefresh }: ModelMetadataCardProps) {
  return (
    <Card
      title="Model Metadata"
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onRefresh}
          isLoading={loading}
          leftIcon={<RefreshCw size={14} />}
        >
          Refresh Metadata
        </Button>
      }
    >
      <p className="text-sm text-text-secondary">
        Catalog metadata for model aliases auto-refreshes every 60 minutes. Use this to trigger an
        immediate reload from OpenRouter, models.dev, and Catwalk.
      </p>
    </Card>
  );
}
