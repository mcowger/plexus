import { Selector } from './base';
import { ModelTarget } from '../../config';

export class RandomSelector extends Selector {
  select(targets: ModelTarget[]): ModelTarget | null {
    if (!targets || targets.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * targets.length);
    return targets[index] || null;
  }
}
