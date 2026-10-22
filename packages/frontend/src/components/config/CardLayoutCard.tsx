import { Download, Upload } from 'lucide-react';
import type { ChangeEvent, RefObject } from 'react';

import type { CardLayout } from '../../types/card';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface CardLayoutCardProps {
  cardLayout: CardLayout;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onImport: () => void;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function CardLayoutCard({
  cardLayout,
  fileInputRef,
  onExport,
  onImport,
  onFileSelect,
}: CardLayoutCardProps) {
  return (
    <Card
      title="Card Layout"
      extra={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onExport}
            leftIcon={<Download size={14} />}
          >
            Export
          </Button>
          <Button variant="primary" size="sm" onClick={onImport} leftIcon={<Upload size={14} />}>
            Import
          </Button>
        </div>
      }
    >
      <p className="text-text-secondary mb-4 text-sm">
        Import or export your Live Metrics card layout configuration.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={onFileSelect}
      />

      <div>
        <h4 className="font-heading text-text-muted mb-3 text-xs font-semibold tracking-wider uppercase">
          Current Card Order
        </h4>
        <div className="flex flex-wrap gap-2">
          {cardLayout.length === 0 && (
            <p className="text-text-muted text-xs italic">
              Default layout — no customizations saved.
            </p>
          )}
          {cardLayout.map((card, index) => (
            <div
              key={card.id}
              className="bg-bg-glass border-border-glass text-text rounded-md border px-3 py-1.5 text-xs"
            >
              <span className="text-text-muted mr-2">{index + 1}.</span>
              {card.id}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
