import { Selector } from './base';
import { ModelTarget } from '../../config';

export class InOrderSelector extends Selector {
  select(targets: ModelTarget[]): ModelTarget | null {
    if (!targets || targets.length === 0) {
      return null;
    }
    // Return the first target in the order they are defined
    return targets[0] || null;
  }
}
