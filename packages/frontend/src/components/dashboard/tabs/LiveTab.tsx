/**
 * @file LiveTab.tsx
 *
 * Core component for the Live Metrics dashboard tab. Renders a real-time view
 * of LLM proxy traffic over a rolling window. The dashboard is built around
 * a drag-and-drop card grid (powered by @dnd-kit) where each card visualises
 * a different facet of live traffic: request velocity, provider and model
 * distributions, timelines, concurrency gauges, and a scrollable request stream.
 *
 * Cards can be reordered via drag-and-drop, and positions are persisted across
 * sessions through the useCardPositions hook. Clicking a card opens an expanded
 * modal view. Each card also exposes an "Analyze" button that opens a
 * DetailedUsage page pre-seeded with a query string relevant to that card's data slice.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useCardPositions } from '../../../hooks/useCardPositions';
import { useLiveDashboardData } from '../../../hooks/useLiveDashboardData';
import type { CardId } from '../../../types/card';
import { buildQueryString, type CardType } from '../../analytics/AnalyzeButton';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { LIVE_WINDOW_OPTIONS, POLL_INTERVAL_OPTIONS, type ModalCardId } from '../liveTypes';
import {
  AlertsCard,
  ConcurrencyCard,
  MetricsCard,
  ModelPulseCard,
  ModelTimelineCard,
  ProviderPulseCard,
  RequestsCard,
  StatsCard,
  TimelineCard,
  VelocityCard,
} from '../cards';
import { LiveDashboardModal } from '../modals';

export interface LiveTabProps {
  /** Current polling interval in milliseconds (5000 / 10000 / 30000) */
  pollInterval: number;
  /** Callback to propagate poll interval changes to the parent (for persistence) */
  onPollIntervalChange: (interval: number) => void;
  /** Current live window period in minutes (5 / 15 / 30 / 1440 / 10080 / 43200) */
  liveWindowPeriod?: number;
  /** Callback to propagate live window period changes to the parent */
  onLiveWindowPeriodChange?: (period: number) => void;
}

export const LiveTab: React.FC<LiveTabProps> = ({
  pollInterval,
  onPollIntervalChange,
  liveWindowPeriod = 5,
  onLiveWindowPeriodChange,
}) => {
  const { isAdmin } = useAuth();

  const data = useLiveDashboardData({
    pollInterval,
    liveWindowPeriod,
    onPollIntervalChange,
    onLiveWindowPeriodChange,
  });

  // ---------------------------------------------------------------------------
  // MODAL STATE
  // ---------------------------------------------------------------------------
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCard, setModalCard] = useState<ModalCardId | null>(null);
  const [detailedUsageQuery, setDetailedUsageQuery] = useState<string | null>(null);

  const openModal = useCallback((card: ModalCardId) => {
    setModalCard(card);
    setModalOpen(true);
  }, []);

  const openDetailedUsageInModal = useCallback((cardType: CardType) => {
    setDetailedUsageQuery(buildQueryString(cardType));
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalCard(null);
    setDetailedUsageQuery(null);
  }, []);

  // ---------------------------------------------------------------------------
  // DRAG-AND-DROP SETUP
  // ---------------------------------------------------------------------------
  const cardIds = useMemo<CardId[]>(
    () => [
      'metrics',
      'alerts',
      'concurrency',
      'velocity',
      'provider',
      'model',
      'stats',
      'timeline',
      'modelstack',
      'requests',
    ],
    []
  );

  const { positions, reorderCards } = useCardPositions(cardIds);
  const [activeCardId, setActiveCardId] = useState<CardId | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveCardId(event.active.id as CardId);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveCardId(null);

      if (over && active.id !== over.id) {
        const oldIndex = positions.findIndex((p) => p.id === active.id);
        const newIndex = positions.findIndex((p) => p.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderCards(oldIndex, newIndex);
        }
      }
    },
    [positions, reorderCards]
  );

  const handleDragCancel = useCallback(() => {
    setActiveCardId(null);
  }, []);

  const orderedCardIds = useMemo<CardId[]>(() => {
    if (positions.length === 0) {
      return cardIds;
    }

    const next = [...positions]
      .sort((a, b) => a.order - b.order)
      .map((position) => position.id)
      .filter((id): id is CardId => cardIds.includes(id as CardId));

    const missing = cardIds.filter((id) => !next.includes(id));
    return [...next, ...missing];
  }, [positions, cardIds]);

  // ---------------------------------------------------------------------------
  // CARD RENDERER
  // ---------------------------------------------------------------------------
  const renderCard = (cardId: CardId, index: number, isOverlay = false) => {
    switch (cardId) {
      case 'metrics':
        return (
          <MetricsCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('stats')}
            totalRequestsValue={data.totalRequestsValue}
            totalTokensValue={data.totalTokensValue}
            todayMetrics={data.todayMetrics}
            liveWindowMinutes={data.liveWindowMinutes}
            summary={data.summary}
            successRate={data.successRate}
            tokensPerMinute={data.tokensPerMinute}
            avgLatency={data.avgLatency}
          />
        );
      case 'alerts':
        return (
          <AlertsCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('stats')}
            cooldowns={data.cooldowns}
            groupedCooldowns={data.groupedCooldowns}
            providerRows={data.providerRows}
            liveWindowMinutes={data.liveWindowMinutes}
            isAdmin={isAdmin}
            onClearCooldowns={data.handleClearCooldowns}
            onClearSingleCooldown={data.handleClearSingleCooldown}
          />
        );
      case 'velocity':
        return (
          <VelocityCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('velocity')}
            onAnalyze={() => openDetailedUsageInModal('velocity')}
            velocitySeries={data.velocitySeries}
          />
        );
      case 'provider':
        return (
          <ProviderPulseCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('provider')}
            onAnalyze={() => openDetailedUsageInModal('provider')}
            providerPulseRows={data.providerPulseRows}
          />
        );
      case 'model':
        return (
          <ModelPulseCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('model')}
            onAnalyze={() => openDetailedUsageInModal('model')}
            modelPulseRows={data.modelPulseRows}
          />
        );
      case 'timeline':
        return (
          <TimelineCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('timeline')}
            onAnalyze={() => openDetailedUsageInModal('timeline')}
            loading={data.loading}
            minuteSeries={data.minuteSeries}
            liveWindowMinutes={data.liveWindowMinutes}
          />
        );
      case 'modelstack':
        return (
          <ModelTimelineCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('modelstack')}
            onAnalyze={() => openDetailedUsageInModal('modelstack')}
            loading={data.loading}
            modelTimeline={data.modelTimeline}
            liveWindowMinutes={data.liveWindowMinutes}
          />
        );
      case 'requests':
        return (
          <RequestsCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('requests')}
            onAnalyze={() => openDetailedUsageInModal('requests')}
            streamFilter={data.streamFilter}
            onFilterChange={data.setStreamFilter}
            liveRequests={data.liveRequests}
            filteredLiveRequests={data.filteredLiveRequests}
          />
        );
      case 'concurrency':
        return (
          <ConcurrencyCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('concurrency')}
            onAnalyze={() => openDetailedUsageInModal('concurrency')}
            concurrencyLoading={data.concurrencyLoading}
            concurrencyHistory={data.concurrencyHistory}
            totalConcurrentRequests={data.totalConcurrentRequests}
            concurrencyProviders={data.concurrencyProviders}
          />
        );
      case 'stats':
        return (
          <StatsCard
            index={index}
            isOverlay={isOverlay}
            onClick={() => openModal('stats')}
            activeProviderCount={data.activeProviderCount}
            activeModelCount={data.activeModelCount}
            providerStats={data.providerStats}
            modelStats={data.modelStats}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="overflow-x-clip px-3 py-4 transition-all duration-300 sm:p-6">
      {/* ------- Page Header ------- */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 sm:mb-8">
        <div className="header-left">
          <h1 className="font-heading text-xl sm:text-3xl font-bold text-text m-0 mb-2">
            Live Metrics
          </h1>
        </div>

        <Badge
          status={data.isConnected && !data.isStale ? 'connected' : 'warning'}
          secondaryText={'Window: last ' + data.liveWindowMinutes + 'm'}
          className="w-full sm:w-auto sm:min-w-[210px]"
        >
          {data.isConnected
            ? data.isStale
              ? 'Live Polling Delayed'
              : 'Live Polling Active'
            : 'Live Polling Reconnecting'}
        </Badge>
      </div>

      {/* ------- Toolbar ------- */}
      <div className="-mx-3 mb-4 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void data.loadData()}
          isLoading={data.isRefreshing}
        >
          <RefreshCw size={14} />
          Refresh Now
        </Button>
        {POLL_INTERVAL_OPTIONS.map((option) => {
          const label = String(Math.floor(option / 1000)) + 's';
          return (
            <Button
              key={option}
              size="sm"
              variant={data.pollIntervalMs === option ? 'primary' : 'secondary'}
              onClick={() => {
                data.setPollIntervalMs(option);
              }}
            >
              Poll {label}
            </Button>
          );
        })}
        <span className="hidden text-xs text-text-secondary sm:inline">|</span>
        {LIVE_WINDOW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={data.liveWindowMinutes === option.value ? 'primary' : 'secondary'}
            onClick={() => {
              data.setLiveWindowMinutes(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
        <span className="hidden text-xs text-text-muted sm:inline">
          {data.isVisible ? 'Tab active' : 'Tab hidden'} - data refresh resumes on focus.
        </span>
      </div>

      {/* ------- Draggable Card Grid ------- */}
      <DndContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={orderedCardIds}>
          <div className="grid min-w-0 grid-cols-1 gap-4 mb-4 lg:grid-cols-2">
            {orderedCardIds.map((cardId, index) => (
              <div key={cardId} className="min-w-0">
                {renderCard(cardId, index)}
              </div>
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeCardId ? (
            <div className="w-[min(100%,720px)]">{renderCard(activeCardId, 0, true)}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ------- Shared Modal Shell ------- */}
      <LiveDashboardModal
        isOpen={modalOpen}
        onClose={closeModal}
        modalCard={modalCard}
        detailedUsageQuery={detailedUsageQuery}
        onBackFromDetailedUsage={() => setDetailedUsageQuery(null)}
        data={data}
      />
    </div>
  );
};
