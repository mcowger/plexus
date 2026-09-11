/**
 * @file StatsModal.tsx
 *
 * Full-height two-column layout with EntityRow lists for providers and models.
 */

import React from 'react';
import { Cpu, Server } from 'lucide-react';
import type { EntityStats } from '../liveTypes';
import { EntityRow } from '../cards/EntityRow';

export interface StatsModalProps {
  providerStats: EntityStats[];
  modelStats: EntityStats[];
}

export const StatsModal: React.FC<StatsModalProps> = ({ providerStats, modelStats }) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text flex items-center gap-2">
          <Server size={18} className="text-primary" />
          Top Providers
        </h3>
        {providerStats.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
            No provider activity in window
          </div>
        ) : (
          <div className="space-y-2">
            {providerStats.map((provider) => (
              <EntityRow key={provider.name} entity={provider} />
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text flex items-center gap-2">
          <Cpu size={18} className="text-secondary" />
          Top Models
        </h3>
        {modelStats.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-text-secondary text-sm">
            No model activity in window
          </div>
        ) : (
          <div className="space-y-2">
            {modelStats.map((model) => (
              <EntityRow key={model.name} entity={model} isModel />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
