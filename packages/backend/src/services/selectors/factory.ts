import { Selector } from './base';
import { RandomSelector } from './random';
import { CostSelector } from './cost';
import { PerformanceSelector } from './performance';
import { LatencySelector } from './latency';
import { InOrderSelector } from './in-order';
import { UsageSelector } from './usage';
import { UsageStorageService } from '../usage-storage';

export class SelectorFactory {
  private static usageStorage: UsageStorageService | null = null;

  static setUsageStorage(storage: UsageStorageService) {
    this.usageStorage = storage;
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
            throw new Error("UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.");
        }
        return new PerformanceSelector(this.usageStorage);
      case 'latency':
        if (!this.usageStorage) {
            throw new Error("UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.");
        }
        return new LatencySelector(this.usageStorage);
      case 'usage':
        if (!this.usageStorage) {
            throw new Error("UsageStorageService not initialized in SelectorFactory. Call setUsageStorage first.");
        }
        return new UsageSelector(this.usageStorage);
      default:
        throw new Error(`Unknown selector type: ${type}`);
    }
  }
}
