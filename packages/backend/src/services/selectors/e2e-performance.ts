import { Selector } from './base';
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

    for (const target of targets) {
      const stats = await this.storage.getProviderPerformance(target.provider, target.model);

      let e2eTps = 0;
      if (stats && stats.length > 0) {
        e2eTps = stats[0].avg_e2e_tokens_per_sec || 0;
      }

      candidates.push({ target, e2eTps });
    }

    // Sort by E2E TPS descending (highest is best)
    candidates.sort((a, b) => b.e2eTps - a.e2eTps);

    const best = candidates[0];
    if (best) {
      // Explore from all candidates (including best) to keep metrics fresh across all providers
      if (explorationRate > 0 && Math.random() < explorationRate && candidates.length > 1) {
        const randomChoice = candidates[Math.floor(Math.random() * candidates.length)];
        if (randomChoice) {
          logger.debug(
            `E2EPerformanceSelector: Exploring - selected ${randomChoice.target.provider}/${randomChoice.target.model} with ${randomChoice.e2eTps.toFixed(2)} E2E TPS (rate: ${(explorationRate * 100).toFixed(1)}%)`
          );
          return randomChoice.target;
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
