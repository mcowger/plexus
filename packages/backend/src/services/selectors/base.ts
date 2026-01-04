import { ModelTarget } from '../../config';

/**
 * EnrichedModelTarget extends ModelTarget with route information
 * that is added by the Router during target enrichment
 */
export interface EnrichedModelTarget extends ModelTarget {
  route?: {
    modelConfig?: any;
  };
}

export abstract class Selector {
  /**
   * Selects a target from a list of available targets.
   * @param targets The list of model targets to choose from.
   * @returns The selected target, or null if no target could be selected.
   */
  abstract select(targets: ModelTarget[]): ModelTarget | null;
}
