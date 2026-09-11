/**
 * @file LiveDashboardModal.tsx
 *
 * Full-screen modal overlay for the Live Metrics dashboard.
 * Renders either an expanded card view or an embedded DetailedUsage analytics page.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { DetailedUsage } from '../../../pages/DetailedUsage';
import type { ModalCardId } from '../liveTypes';
import type { LiveDashboardData } from '../../../hooks/useLiveDashboardData';
import { VelocityModal } from './VelocityModal';
import { ProviderPulseModal } from './ProviderPulseModal';
import { ModelPulseModal } from './ModelPulseModal';
import { TimelineModal } from './TimelineModal';
import { ModelTimelineModal } from './ModelTimelineModal';
import { RequestsModal } from './RequestsModal';
import { ConcurrencyModal } from './ConcurrencyModal';
import { StatsModal } from './StatsModal';

export interface LiveDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalCard: ModalCardId | null;
  detailedUsageQuery: string | null;
  onBackFromDetailedUsage: () => void;
  data: LiveDashboardData;
}

export const getLiveModalTitle = (
  modalCard: ModalCardId | null,
  detailedUsageQuery: string | null
): string => {
  if (detailedUsageQuery) {
    return 'Detailed Usage';
  }
  switch (modalCard) {
    case 'velocity':
      return 'Request Velocity (Last 5 Minutes)';
    case 'provider':
      return 'Provider Pulse (5m)';
    case 'model':
      return 'Model Pulse (5m)';
    case 'timeline':
      return 'Live Timeline';
    case 'modelstack':
      return 'Model Stack + Runtime';
    case 'requests':
      return 'Latest Requests';
    case 'concurrency':
      return 'Concurrency';
    case 'stats':
      return 'Provider & Model Stats';
    default:
      return '';
  }
};

export const LiveDashboardModal: React.FC<LiveDashboardModalProps> = ({
  isOpen,
  onClose,
  modalCard,
  detailedUsageQuery,
  onBackFromDetailedUsage,
  data,
}) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
    }
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = getLiveModalTitle(modalCard, detailedUsageQuery);

  const renderContent = () => {
    if (detailedUsageQuery) {
      return (
        <DetailedUsage
          embedded
          initialQueryString={detailedUsageQuery}
          onBack={onBackFromDetailedUsage}
        />
      );
    }

    switch (modalCard) {
      case 'velocity':
        return <VelocityModal velocitySeries={data.velocitySeries} />;
      case 'provider':
        return <ProviderPulseModal providerPulseRows={data.providerPulseRows} />;
      case 'model':
        return <ModelPulseModal modelPulseRows={data.modelPulseRows} />;
      case 'timeline':
        return <TimelineModal minuteSeries={data.minuteSeries} />;
      case 'modelstack':
        return <ModelTimelineModal modelTimeline={data.modelTimeline} />;
      case 'requests':
        return (
          <RequestsModal
            liveRequests={data.liveRequests}
            filteredLiveRequests={data.filteredLiveRequests}
          />
        );
      case 'concurrency':
        return (
          <ConcurrencyModal
            concurrencyHistory={data.concurrencyHistory}
            totalConcurrentRequests={data.totalConcurrentRequests}
            concurrencyProviders={data.concurrencyProviders}
          />
        );
      case 'stats':
        return <StatsModal providerStats={data.providerStats} modelStats={data.modelStats} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[90vh] overflow-auto rounded-lg border border-border-glass bg-bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X size={24} className="text-text-secondary" />
          </button>
        </div>
        {renderContent()}
      </div>
    </div>
  );
};
