/**
 * @file LiveDashboardModal.tsx
 *
 * Full-screen modal overlay for the Live Metrics dashboard.
 * Renders either an expanded card view or an embedded DetailedUsage analytics page.
 */

import { X } from 'lucide-react';
import React, { useEffect } from 'react';

import type { LiveDashboardData } from '../../../hooks/useLiveDashboardData';
import { DetailedUsage } from '../../../pages/DetailedUsage';
import type { ModalCardId } from '../liveTypes';
import { ConcurrencyModal } from './ConcurrencyModal';
import { ModelPulseModal } from './ModelPulseModal';
import { ModelTimelineModal } from './ModelTimelineModal';
import { ProviderPulseModal } from './ProviderPulseModal';
import { RequestsModal } from './RequestsModal';
import { StatsModal } from './StatsModal';
import { TimelineModal } from './TimelineModal';
import { VelocityModal } from './VelocityModal';

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
        className="border-border-glass bg-bg-card relative max-h-[90vh] w-full max-w-6xl overflow-auto rounded-lg border p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-text text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="hover:bg-bg-hover cursor-pointer rounded-lg p-2 transition-colors"
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
