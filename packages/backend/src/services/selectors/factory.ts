import { Selector } from './base';
import { RandomSelector } from './random';
import { CostSelector } from './cost';

export class SelectorFactory {
  static getSelector(type?: string): Selector {
    switch (type) {
      case 'random':
      case undefined:
      case null:
        return new RandomSelector();
      case 'cost':
        return new CostSelector();
      case 'latency':
        // Placeholder for future implementation
        throw new Error("Selector 'latency' not implemented yet");
      case 'usage':
        // Placeholder for future implementation
        throw new Error("Selector 'usage' not implemented yet");
      default:
        throw new Error(`Unknown selector type: ${type}`);
    }
  }
}
