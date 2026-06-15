import { Selector, CandidateStats } from './base';
import { ModelTarget } from '../../config';
import { UsageStorageService } from '../usage-storage';
import { logger } from '../../utils/logger';
import { getConfig } from '../../config';

export class LatencySelector extends Selector {
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

    // Optimization: If we wanted to reduce DB calls, we could fetch all at once,
    // but the API is structured for per-provider/model queries.

    const candidates: { target: ModelTarget; avgTtft: number }[] = [];
    const explorationStats: CandidateStats[] = [];

    for (const target of targets) {
      const stats = await this.storage.getProviderPerformance(target.provider, target.model);
      const targetStats = stats[0];

      let avgTtft = Infinity; // Default to worst possible latency if no data

      if (targetStats) {
        if (targetStats.avg_ttft_ms !== null && targetStats.avg_ttft_ms !== undefined) {
          avgTtft = targetStats.avg_ttft_ms;
        }
      }

      candidates.push({ target, avgTtft });
      explorationStats.push({
        target,
        sampleCount: targetStats?.sample_count ?? 0,
        lastUpdated: targetStats?.last_updated ?? 0,
      });
    }

    // Filter out candidates with no data (Infinity) if possible
    const validCandidates = candidates.filter((c) => c.avgTtft !== Infinity);

    // If we have valid candidates, sort by TTFT ascending (lowest is best)
    if (validCandidates.length > 0) {
      validCandidates.sort((a, b) => a.avgTtft - b.avgTtft);

      const config = getConfig();
      const bgEnabled = config.backgroundExploration?.enabled === true;
      const explorationRate = bgEnabled
        ? 0
        : (config.latencyExplorationRate ?? config.performanceExplorationRate ?? 0);

      // If exploration rate is set and we have multiple candidates, occasionally explore
      if (explorationRate > 0 && validCandidates.length > 1 && Math.random() < explorationRate) {
        const explorationChoice = this.pickExplorationTarget(explorationStats);
        if (explorationChoice) {
          const choiceStats = candidates.find(
            (c) =>
              c.target.provider === explorationChoice.provider &&
              c.target.model === explorationChoice.model
          );
          const ttft = choiceStats?.avgTtft;
          logger.debug(
            `LatencySelector: Exploring - selected ${explorationChoice.provider}/${explorationChoice.model} with ${
              ttft !== undefined && ttft !== Infinity ? ttft.toFixed(2) : 'no'
            } ms TTFT (rate: ${(explorationRate * 100).toFixed(1)}%)`
          );
          return explorationChoice;
        }
      }

      const best = validCandidates[0];
      if (best) {
        logger.debug(
          `LatencySelector: Selected ${best.target.provider}/${best.target.model} with ${best.avgTtft.toFixed(2)}ms TTFT`
        );
        return best.target;
      }
    }

    // If no valid candidates (all have no data), fallback to first target
    return targets[0] ?? null;
  }
}
