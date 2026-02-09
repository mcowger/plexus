import { Selector } from './base';
import { ModelTarget, getConfig } from '../../config';
import { UsageStorageService } from '../usage-storage';
import { logger } from '../../utils/logger';

export class PerformanceSelector extends Selector {
  private storage: UsageStorageService;

  constructor(storage: UsageStorageService) {
    super();
    this.storage = storage;
  }

  async select(targets: ModelTarget[]): Promise<ModelTarget | null> {
    if (!targets || targets.length === 0) {
      return null;
    }

    if (targets.length === 1) {
      return targets[0] ?? null;
    }

    // Get exploration rate from config (default 5%)
    const config = getConfig();
    const explorationRate = config.performanceExplorationRate ?? 0.05;

    // If no performance data exists, we might want to fall back to random or first.
    // For now, let's assume we want to pick the one with highest known performance.
    // If no data for any, we pick random (or first).
    
    // We need to query for each target.
    // Optimization: we could query all performance stats and filter in memory, 
    // but getProviderPerformance allows filtering by provider/model.
    // Given targets usually small (2-5), individual queries are fine.

    const candidates: { target: ModelTarget; tps: number }[] = [];

    for (const target of targets) {
      const stats = await this.storage.getProviderPerformance(target.provider, target.model);
      
      let avgTps = 0;
      if (stats && stats.length > 0) {
        // stats[0] contains the aggregated data for this provider/model
        avgTps = stats[0].avg_tokens_per_sec || 0;
      }

      candidates.push({ target, tps: avgTps });
    }

    // Sort by TPS descending
    candidates.sort((a, b) => b.tps - a.tps);

    if (candidates.length > 0) {
        const best = candidates[0];
        if (best) {
            // If the best has 0 TPS (no data), and others also have 0, 
            // strictly speaking they are equal. The sort is stable or undefined for equals.
            // We pick the top one.

            // Check if we should explore a different provider (randomly choose from non-best targets)
            if (explorationRate > 0 && Math.random() < explorationRate && candidates.length > 1) {
                const nonBestCandidates = candidates.slice(1);
                const randomChoice = nonBestCandidates[Math.floor(Math.random() * nonBestCandidates.length)];
                if (randomChoice) {
                    logger.debug(`PerformanceSelector: Exploring - selected ${randomChoice.target.provider}/${randomChoice.target.model} with ${randomChoice.tps.toFixed(2)} TPS (instead of ${best.target.provider}/${best.target.model} with ${best.tps.toFixed(2)} TPS)`);
                    return randomChoice.target;
                }
            }

            logger.debug(`PerformanceSelector: Selected ${best.target.provider}/${best.target.model} with ${best.tps.toFixed(2)} TPS`);
            return best.target;
        }
    }

    return targets[0] ?? null;
  }
}
