import type { Context } from '@earendil-works/pi-ai';
import { logger } from '../../utils/logger';
import { getConfig, type ModelConfig } from '../../config';
import { resolveContextLength } from '../enforce-limits';
import { estimateContextTokens } from '../../utils/estimate-tokens';
import type { RouteResult } from '../router';
import { NativeCompactor } from './native-compactor';
import { HeadroomCompactor } from './headroom-compactor';
import { resolveCompactionSettings } from './resolve-settings';
import type {
  CompactionResult,
  CompactionSettings,
  CompactionStrategy,
  CompactionStrategyName,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaybeCompactOpts {
  aliasConfig?: ModelConfig;
  providerCompaction?: CompactionSettings;
  /** Resolved provider id — part of the memo key so failover candidates with
   *  different per-provider compaction overrides don't reuse each other's result. */
  provider?: string;
  model: string;
  contextLength?: number;
  signal?: AbortSignal;
}

type Strategies = Record<CompactionStrategyName, CompactionStrategy>;
type EstimateFn = (context: Context) => number;
type GetGlobalFn = () => CompactionSettings | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error('compaction timeout')), ms);
    // Allow Node/Bun process to exit even if this timeout is still pending
    if (typeof timer === 'object' && timer !== null && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  });
  // Clear the timer once either side settles so a winning strategy doesn't leave
  // a live timeout dangling for the full `ms` window.
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// CompactionService
// ---------------------------------------------------------------------------

export class CompactionService {
  private static instance: CompactionService | undefined;

  constructor(
    private strategies: Strategies,
    private estimateFn: EstimateFn,
    private getGlobal: GetGlobalFn
  ) {}

  static getInstance(): CompactionService {
    if (!this.instance) {
      this.instance = new CompactionService(
        { native: new NativeCompactor(), headroom: new HeadroomCompactor() },
        (ctx) => estimateContextTokens(ctx),
        () => getConfig().compaction
      );
    }
    return this.instance;
  }

  async maybeCompact(
    context: Context,
    opts: MaybeCompactOpts,
    memo: Map<string, CompactionResult>
  ): Promise<CompactionResult> {
    // 1. Resolve settings
    const settings = resolveCompactionSettings(
      this.getGlobal(),
      opts.providerCompaction,
      opts.aliasConfig?.compaction
    );

    // 2. Disabled fast-path
    if (!settings.enabled) {
      return {
        compacted: false,
        context,
        tokensBefore: 0,
        tokensAfter: 0,
        strategy: null,
        reason: 'disabled',
      };
    }

    // 3. Estimate tokens; check below-min
    const tokensBefore = this.estimateFn(context);
    if (tokensBefore < settings.minTokens) {
      return {
        compacted: false,
        context,
        tokensBefore,
        tokensAfter: tokensBefore,
        strategy: null,
        reason: 'below-min',
      };
    }

    // 4. Resolve contextLength
    const contextLength =
      opts.contextLength ?? (opts.aliasConfig ? resolveContextLength(opts.aliasConfig) : undefined);

    // 5. Trigger check
    const fire =
      (contextLength != null && tokensBefore >= settings.triggerRatio * contextLength) ||
      (settings.absoluteTriggerTokens != null && tokensBefore >= settings.absoluteTriggerTokens);

    if (!fire) {
      return {
        compacted: false,
        context,
        tokensBefore,
        tokensAfter: tokensBefore,
        strategy: null,
        reason: 'under-threshold',
      };
    }

    // 6. Memo check — keyed by provider+model+contextLength so a failover
    // candidate with a different per-provider compaction override recomputes
    // instead of reusing the prior candidate's result.
    const key = `${opts.provider ?? ''}:${opts.model}:${contextLength ?? 'na'}`;
    if (memo.has(key)) {
      return memo.get(key)!;
    }

    // 7. Run strategy with timeout (fail-open)
    const strategy = this.strategies[settings.strategy];
    let newMessages: Context['messages'];
    try {
      newMessages = await runWithTimeout(
        strategy.compact(context, settings, {
          model: opts.model,
          contextLength,
          signal: opts.signal,
        }),
        settings.headroom.timeoutMs
      );
    } catch (err) {
      logger.warn(
        `[compaction] strategy '${settings.strategy}' failed (fail-open): ${(err as Error)?.message}`
      );
      // Do NOT memo errors
      return {
        compacted: false,
        context,
        tokensBefore,
        tokensAfter: tokensBefore,
        strategy: settings.strategy,
        reason: 'error',
      };
    }

    // 8. Build new context and re-estimate
    const newContext: Context = { ...context, messages: newMessages };
    const tokensAfter = this.estimateFn(newContext);

    // 9. Validation guard
    let result: CompactionResult;
    if (tokensAfter >= tokensBefore) {
      result = {
        compacted: false,
        context, // revert to original
        tokensBefore,
        tokensAfter,
        strategy: settings.strategy,
        reason: 'no-reduction',
      };
    } else {
      result = {
        compacted: true,
        context: newContext,
        tokensBefore,
        tokensAfter,
        strategy: settings.strategy,
        reason: 'ok',
      };
      logger.info(
        `[compaction] ${settings.strategy} ${tokensBefore}→${tokensAfter} tokens (${opts.model})`
      );
    }

    // 10. Memo and return
    memo.set(key, result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// compactContextForSend (executor helper — used by Task 5)
// ---------------------------------------------------------------------------

export async function compactContextForSend(
  context: Context,
  route: RouteResult,
  modelAlias: string,
  memo: Map<string, CompactionResult>,
  signal?: AbortSignal
): Promise<CompactionResult> {
  const aliasConfig = getConfig().models?.[route.canonicalModel ?? modelAlias];
  const contextLength =
    (aliasConfig ? resolveContextLength(aliasConfig) : undefined) ??
    route.modelArchitecture?.context_length;
  return CompactionService.getInstance().maybeCompact(
    context,
    {
      aliasConfig,
      providerCompaction: route.config.compaction,
      provider: route.provider,
      model: route.canonicalModel ?? modelAlias,
      contextLength,
      signal,
    },
    memo
  );
}
