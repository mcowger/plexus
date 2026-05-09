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

export interface CandidateStats {
  target: ModelTarget;
  sampleCount: number;
  lastUpdated: number; // epoch ms, 0 if no data
}

export abstract class Selector {
  /**
   * Selects a target from a list of available targets.
   * @param targets The list of model targets to choose from.
   * @returns The selected target, or null if no target could be selected.
   */
  abstract select(targets: ModelTarget[]): ModelTarget | null | Promise<ModelTarget | null>;

  /**
   * Picks the best exploration candidate from a list:
   * - Targets with no samples are prioritised (picked randomly among them)
   * - If all targets have data, picks the one with the oldest last_updated timestamp
   */
  protected pickExplorationTarget(candidates: CandidateStats[]): ModelTarget | null {
    const unseen = candidates.filter((c) => c.sampleCount === 0);
    if (unseen.length > 0) {
      return unseen[Math.floor(Math.random() * unseen.length)]!.target;
    }
    // All have data — pick the stalest
    const stalest = candidates.reduce((a, b) => (a.lastUpdated <= b.lastUpdated ? a : b));
    return stalest.target;
  }
}
