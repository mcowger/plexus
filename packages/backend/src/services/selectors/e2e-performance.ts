import { Selector, CandidateStats } from './base';
import { ModelTarget, getConfig } from '../../config';
import { UsageStorageService } from '../usage-storage';
import { logger } from '../../utils/logger';

export class E2EPerformanceSelector extends Selector {
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

    const config = getConfig();
    const explorationRate =
      config.e2ePerformanceExplorationRate ?? config.performanceExplorationRate ?? 0.05;

    const candidates: { target: ModelTarget; e2eTps: number }[] = [];
    const explorationStats: CandidateStats[] = [];

    for (const target of targets) {
      const stats = await this.storage.getProviderPerformance(target.provider, target.model);
      const targetStats = stats[0];

      let e2eTps = 0;
      if (targetStats) {
        e2eTps = targetStats.avg_e2e_tokens_per_sec || 0;
      }

      candidates.push({ target, e2eTps });
      explorationStats.push({
        target,
        sampleCount: targetStats?.sample_count ?? 0,
        lastUpdated: targetStats?.last_updated ?? 0,
      });
    }

    // Sort by E2E TPS descending (highest is best)
    candidates.sort((a, b) => b.e2eTps - a.e2eTps);

    const best = candidates[0];
    if (best) {
      // Explore from all candidates (including best) to keep metrics fresh across all providers
      if (explorationRate > 0 && Math.random() < explorationRate && candidates.length > 1) {
        const explorationChoice = this.pickExplorationTarget(explorationStats);
        if (explorationChoice) {
          const choiceStats = candidates.find(
            (c) =>
              c.target.provider === explorationChoice.provider &&
              c.target.model === explorationChoice.model
          );
          logger.debug(
            `E2EPerformanceSelector: Exploring - selected ${explorationChoice.provider}/${explorationChoice.model} with ${
              choiceStats?.e2eTps.toFixed(2) ?? '0.00'
            } E2E TPS (rate: ${(explorationRate * 100).toFixed(1)}%)`
          );
          return explorationChoice;
        }
      }

      logger.debug(
        `E2EPerformanceSelector: Selected ${best.target.provider}/${best.target.model} with ${best.e2eTps.toFixed(2)} E2E TPS`
      );
      return best.target;
    }

    return targets[0] ?? null;
  }
}
