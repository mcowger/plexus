import { AlertCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { QuotaStatusCard } from '../../components/quota';
import { sortMostConstrainedFirst } from '../../lib/quota';
import type { UserQuota } from '../../lib/api';
import { isLeakyRollingDef } from './helpers';
import type { QuotaStatusResponse } from './types';

interface QuotaStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedQuotaName: string | null;
  selectedQuotaStatus: QuotaStatusResponse | null;
  quotas: Record<string, UserQuota>;
  recomputingQuota: string | null;
  onClearQuota: (keyName: string, quotaName?: string) => void;
  onRecomputeQuota: (keyName: string, quotaName: string) => void;
}

export const QuotaStatusModal = ({
  isOpen,
  onClose,
  selectedQuotaName,
  selectedQuotaStatus,
  quotas,
  recomputingQuota,
  onClearQuota,
  onRecomputeQuota,
}: QuotaStatusModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={`Quota Status: ${selectedQuotaName}`}
    size="md"
    footer={
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {selectedQuotaStatus && selectedQuotaStatus.quotas.length > 0 && (
          <Button onClick={() => onClearQuota(selectedQuotaStatus.key)} variant="secondary">
            Reset All
          </Button>
        )}
      </div>
    }
  >
    {selectedQuotaStatus && (
      <div className="flex flex-col gap-4">
        {selectedQuotaStatus.quotas.length === 0 ? (
          <div className="flex items-center gap-3 p-3 bg-bg-subtle rounded-md">
            <AlertCircle className="text-text-muted" size={20} />
            <p className="text-sm text-text-secondary">
              No quota assigned to this key, and no default quotas are configured.
            </p>
          </div>
        ) : (
          sortMostConstrainedFirst(selectedQuotaStatus.quotas).map((entry) => (
            <QuotaStatusCard
              key={entry.name}
              entry={entry}
              variant="detailed"
              onReset={(name) => onClearQuota(selectedQuotaStatus.key, name)}
              onRecompute={(name) => onRecomputeQuota(selectedQuotaStatus.key, name)}
              recomputeLeaky={isLeakyRollingDef(quotas[entry.name])}
              recomputing={recomputingQuota === entry.name}
            />
          ))
        )}
      </div>
    )}
  </Modal>
);
