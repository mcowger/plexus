/**
 * @file StatsCard.tsx
 *
 * Draggable card rendering a two-column layout of top provider and model stats
 * using EntityRow components.
 */

import React from 'react';
import { Cpu, Server } from 'lucide-react';
import { SortableCard } from '../../ui/SortableCard';
import type { EntityStats } from '../liveTypes';
import { EntityRow } from './EntityRow';

export interface StatsCardProps {
  index: number;
  isOverlay?: boolean;
  onClick?: () => void;
  activeProviderCount: number;
  activeModelCount: number;
  providerStats: EntityStats[];
  modelStats: EntityStats[];
}

export const StatsCard: React.FC<StatsCardProps> = ({
  index,
  isOverlay = false,
  onClick,
  activeProviderCount,
  activeModelCount,
  providerStats,
  modelStats,
}) => {
  return (
    <SortableCard
      key="sortable-stats"
      card={{
        id: 'stats',
        title: 'Provider & Model Stats',
        extra: (
          <span className="text-xs text-text-secondary">
            {activeProviderCount} providers, {activeModelCount} models
          </span>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content: (
          <div className="h-48 sm:h-56 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <Server size={16} className="text-primary" />
                Top Providers
              </h4>
              {providerStats.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                  No provider activity in window
                </div>
              ) : (
                <div className="space-y-2 max-h-70 overflow-y-auto pr-1">
                  {providerStats.map((provider) => (
                    <EntityRow key={provider.name} entity={provider} />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <Cpu size={16} className="text-secondary" />
                Top Models
              </h4>
              {modelStats.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
                  No model activity in window
                </div>
              ) : (
                <div className="space-y-2 max-h-70 overflow-y-auto pr-1">
                  {modelStats.map((model) => (
                    <EntityRow key={model.name} entity={model} isModel />
                  ))}
                </div>
              )}
            </div>
          </div>
        ),
      }}
      index={index}
      isOverlay={isOverlay}
    />
  );
};
