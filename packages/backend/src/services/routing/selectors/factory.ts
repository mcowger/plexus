import { Selector } from './base';
import { RandomSelector } from './random';
import { CostSelector } from './cost';
import { PerformanceSelector } from './performance';
import { E2EPerformanceSelector } from './e2e-performance';
import { LatencySelector } from './latency';
import { InOrderSelector } from './in-order';
import { UsageSelector } from './usage';
import { UsageStorageService } from '../../observability/usage-storage';
import { QuotaScheduler } from '../../quota/quota-scheduler';
import { QuotaSelector } from './quota';

export class SelectorFactory {
  private static usageStorage: UsageStorageService | null = null;
  private static quotaScheduler: QuotaScheduler | null = null;

  static setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
  }

  static setQuotaScheduler(scheduler: QuotaScheduler | null) {
    this.quotaScheduler = scheduler;
  }

  static getSelector(type?: string): Selector {
    switch (type) {
      case 'random':
      case undefined:
      case null:
        return new RandomSelector();
      case 'in_order':
        return new InOrderSelector();
      case 'cost':
        return new CostSelector();
      case 'performance':
        if (!this.usageStorage) {
          throw new Error(
            'UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.'
          );
        }
        return new PerformanceSelector(this.usageStorage);
      case 'e2e_performance':
        if (!this.usageStorage) {
          throw new Error(
            'UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.'
          );
        }
        return new E2EPerformanceSelector(this.usageStorage);
      case 'latency':
        if (!this.usageStorage) {
          throw new Error(
            'UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.'
          );
        }
        return new LatencySelector(this.usageStorage);
      case 'usage':
        if (!this.usageStorage) {
          throw new Error(
            'UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.'
          );
        }
        return new UsageSelector(this.usageStorage);
      case 'quota':
        if (!this.quotaScheduler) {
          throw new Error(
            'QuotaScheduler not initialized in SelectorFactory. Call setQuotaScheduler first.'
          );
        }
        return new QuotaSelector(this.quotaScheduler);
      default:
        throw new Error(`Unknown selector type: ${type}`);
    }
  }
}
