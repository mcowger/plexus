import { Selector } from './base';
import { ModelTarget } from '../../config';
import { UsageStorageService } from '../usage-storage';
import { logger } from '../../utils/logger';

export class UsageSelector extends Selector {
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

    // Get usage counts for each target from recent history
    // We'll look at the last 24 hours of usage
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString();
    
    const candidates: { target: ModelTarget; usageCount: number }[] = [];

    for (const target of targets) {
      // Query usage for this specific provider/model combination
      const usage = await this.storage.getUsage(
        {
          provider: target.provider,
          selectedModelName: target.model,
          startDate: oneDayAgo,
          endDate: today
        },
        { limit: 1000, offset: 0 }
      );

      candidates.push({ target, usageCount: usage.total });
    }

    // Sort by usage count ascending (least used first)
    candidates.sort((a, b) => a.usageCount - b.usageCount);

    if (candidates.length > 0) {
      const leastUsed = candidates[0];
      if (leastUsed) {
        logger.debug(`UsageSelector: Selected ${leastUsed.target.provider}/${leastUsed.target.model} with ${leastUsed.usageCount} recent requests`);
        return leastUsed.target;
      }
    }

    return targets[0] ?? null;
  }
}
