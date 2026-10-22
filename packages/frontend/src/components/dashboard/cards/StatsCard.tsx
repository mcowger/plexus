/**
 * @file StatsCard.tsx
 *
 * Draggable card rendering a two-column layout of top provider and model stats
 * using EntityRow components.
 */

import { Cpu, Server } from 'lucide-react';
import React from 'react';

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
          <span className="text-text-secondary text-xs">
            {activeProviderCount} providers, {activeModelCount} models
          </span>
        ),
        onClick,
        style: { cursor: 'pointer' },
        className: 'hover:shadow-lg hover:border-primary/30 transition-all',
        content: (
          <div className="grid h-48 grid-cols-1 gap-4 overflow-y-auto sm:h-56 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-text flex items-center gap-2 text-sm font-semibold">
                <Server size={16} className="text-primary" />
                Top Providers
              </h4>
              {providerStats.length === 0 ? (
                <div className="text-text-secondary flex h-32 items-center justify-center text-sm">
                  No provider activity in window
                </div>
              ) : (
                <div className="max-h-70 space-y-2 overflow-y-auto pr-1">
                  {providerStats.map((provider) => (
                    <EntityRow key={provider.name} entity={provider} />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-text flex items-center gap-2 text-sm font-semibold">
                <Cpu size={16} className="text-secondary" />
                Top Models
              </h4>
              {modelStats.length === 0 ? (
                <div className="text-text-secondary flex h-32 items-center justify-center text-sm">
                  No model activity in window
                </div>
              ) : (
                <div className="max-h-70 space-y-2 overflow-y-auto pr-1">
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
