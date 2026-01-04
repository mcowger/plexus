import { Selector } from './base';
import { ModelTarget } from '../../config';
import { UsageStorageService } from '../usage-storage';
import { logger } from '../../utils/logger';

export class LatencySelector extends Selector {
  private storage: UsageStorageService;

  constructor(storage: UsageStorageService) {
    super();
    this.storage = storage;
  }

  select(targets: ModelTarget[]): ModelTarget | null {
    if (!targets || targets.length === 0) {
      return null;
    }

    if (targets.length === 1) {
      return targets[0] ?? null;
    }

    // Optimization: If we wanted to reduce DB calls, we could fetch all at once, 
    // but the API is structured for per-provider/model queries.

    const candidates: { target: ModelTarget; avgTtft: number }[] = [];

    for (const target of targets) {
      const stats = this.storage.getProviderPerformance(target.provider, target.model);
      
      let avgTtft = Infinity; // Default to worst possible latency if no data
      
      if (stats && stats.length > 0) {
        // stats[0] contains the aggregated data for this provider/model
        // If avg_ttft_ms is null (no data), it stays Infinity
        if (stats[0].avg_ttft_ms !== null && stats[0].avg_ttft_ms !== undefined) {
             avgTtft = stats[0].avg_ttft_ms;
        }
      }

      candidates.push({ target, avgTtft });
    }

    // Filter out candidates with no data (Infinity) if possible
    const validCandidates = candidates.filter(c => c.avgTtft !== Infinity);

    // If we have valid candidates, sort by TTFT ascending (lowest is best)
    if (validCandidates.length > 0) {
        validCandidates.sort((a, b) => a.avgTtft - b.avgTtft);
        const best = validCandidates[0];
        if (best) {
            logger.debug(`LatencySelector: Selected ${best.target.provider}/${best.target.model} with ${best.avgTtft.toFixed(2)}ms TTFT`);
            return best.target;
        }
    }

    // If no valid candidates (all have no data), fallback to first target
    return targets[0] ?? null;
  }
}
