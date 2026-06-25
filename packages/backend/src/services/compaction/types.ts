import type { Context } from '@earendil-works/pi-ai';

export type CompactionStrategyName = 'native' | 'headroom';

export interface CompactionSettings {
  // partial override (provider/alias/global)
  enabled?: boolean;
  strategy?: CompactionStrategyName;
  triggerRatio?: number; // 0..1 of context_length
  absoluteTriggerTokens?: number | null; // fallback when context_length unknown
  minTokens?: number; // never compact below this estimate
  protectRecent?: number; // keep most recent N messages untouched
  native?: { maxArrayItems?: number; maxStringChars?: number };
  headroom?: { baseUrl?: string; apiKey?: string; targetRatio?: number | null; timeoutMs?: number };
}

export interface ResolvedCompactionSettings {
  enabled: boolean;
  strategy: CompactionStrategyName;
  triggerRatio: number;
  absoluteTriggerTokens: number | null;
  minTokens: number;
  protectRecent: number;
  native: { maxArrayItems: number; maxStringChars: number };
  headroom: { baseUrl: string; apiKey?: string; targetRatio: number | null; timeoutMs: number };
}

export interface CompactionResult {
  compacted: boolean;
  context: Context; // new context to send (or the original)
  tokensBefore: number;
  tokensAfter: number;
  strategy: CompactionStrategyName | null;
  reason: 'disabled' | 'below-min' | 'under-threshold' | 'no-reduction' | 'error' | 'ok';
}

export interface CompactionStrategyContext {
  model: string;
  contextLength?: number;
  signal?: AbortSignal;
}

export interface CompactionStrategy {
  readonly name: CompactionStrategyName;
  /** Compact context.messages; return NEW messages (never mutate input). May throw (service fails open). */
  compact(
    context: Context,
    settings: ResolvedCompactionSettings,
    ctx: CompactionStrategyContext
  ): Promise<Context['messages']>;
}

export const COMPACTION_DEFAULTS: ResolvedCompactionSettings = {
  enabled: false,
  strategy: 'native',
  triggerRatio: 0.8,
  absoluteTriggerTokens: null,
  minTokens: 2000,
  protectRecent: 4,
  native: { maxArrayItems: 50, maxStringChars: 4000 },
  headroom: {
    baseUrl: 'http://localhost:8787',
    apiKey: undefined,
    targetRatio: null,
    timeoutMs: 5000,
  },
};
