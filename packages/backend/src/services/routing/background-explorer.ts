import { logger } from '../../utils/logger';
import {
  getConfig,
  ModelConfig,
  ModelTargetGroup,
  ProviderConfig,
  SelectorType,
} from '../../config';
import { CooldownManager } from '../runtime/cooldown-manager';
import { ProbeService } from '../probes/probe-service';
import { PendingTasks } from '../runtime/pending-tasks';

type TargetKey = `${string}:${string}`;
type ModelKind = NonNullable<ModelConfig['type']>;

interface TargetState {
  lastProbedAt: number;
  inFlight: boolean;
}

const PERFORMANCE_SELECTORS: SelectorType[] = ['latency', 'performance', 'e2e_performance'];

/**
 * Declared `type` of a concrete target: the provider's model config first,
 * the alias-level declaration as the fallback. `undefined` when neither
 * declares one — an untyped model is a text model.
 *
 * `models` may be the shorthand `string[]` form, which carries no types.
 */
function declaredModelType(
  providerCfg: ProviderConfig,
  model: string,
  aliasType: ModelKind | undefined
): ModelKind | undefined {
  const models = providerCfg.models;
  if (models && !Array.isArray(models)) {
    const declared = models[model]?.type;
    if (declared) return declared;
  }
  return aliasType;
}

/**
 * BackgroundExplorer keeps performance data (TTFT / TPS / E2E TPS) fresh by
 * firing representative synthetic probes at stale targets in the background,
 * independently of live request routing.
 *
 * Triggered by maybeTrigger(group), which is called from the router after a
 * target has been selected for a live request. The live request itself is
 * never affected by exploration — probes run after the trigger returns.
 */
export class BackgroundExplorer {
  private static instance: BackgroundExplorer | null = null;

  private probeService: ProbeService;
  private state = new Map<TargetKey, TargetState>();
  private queue: Array<{ provider: string; model: string }> = [];
  private activeWorkers = 0;
  private shuttingDown = false;
  private tasks = new PendingTasks();
  private readonly processStartTime = Date.now();

  private constructor(probeService: ProbeService) {
    this.probeService = probeService;
  }

  static initialize(probeService: ProbeService): BackgroundExplorer {
    if (!BackgroundExplorer.instance) {
      BackgroundExplorer.instance = new BackgroundExplorer(probeService);
    }
    return BackgroundExplorer.instance;
  }

  static getInstance(): BackgroundExplorer | null {
    return BackgroundExplorer.instance;
  }

  static resetForTesting(): void {
    BackgroundExplorer.instance = null;
  }

  /**
   * Inspect a target group selected by the router. For each target whose
   * `lastProbedAt` is older than the staleness threshold, that is healthy
   * (not on cooldown), and that is not already in flight, enqueue a probe.
   *
   * Non-text targets are skipped: every background probe is chat-shaped (see
   * probe-request.ts), so `aliasType` is passed in only to recognise them.
   *
   * Non-blocking. Returns immediately. Safe to call on every live request.
   */
  maybeTrigger(group: ModelTargetGroup, aliasType?: ModelKind): void {
    if (this.shuttingDown) return;
    const config = getConfig();
    const bg = config.backgroundExploration;
    if (!bg || bg.enabled !== true) {
      return;
    }

    if (!PERFORMANCE_SELECTORS.includes(group.selector)) {
      return;
    }

    const now = Date.now();
    const thresholdMs = bg.stalenessThresholdSeconds * 1000;
    const cooldownMgr = CooldownManager.getInstance();

    // Snapshot of provider config so we can skip disabled providers/targets.
    const providers = config.providers;

    for (const target of group.targets) {
      if (target.enabled === false) continue;
      if (target.alias || !target.provider || !target.model) continue;
      const providerCfg = providers[target.provider];
      if (!providerCfg || providerCfg.enabled === false) continue;

      // Probes are CHAT-shaped, so a non-text target can never answer one.
      // For an `image` target that is not merely wasteful: the chat-to-image
      // bridge turns a chat-shaped request naming an image model into a real
      // image generation, so every staleness tick would bill an image.
      const modelType = declaredModelType(providerCfg, target.model, aliasType);
      if (modelType && modelType !== 'text') {
        logger.debug(
          `BackgroundExplorer: skipping ${target.provider}/${target.model} — model type '${modelType}' is not probeable with a chat probe`
        );
        continue;
      }

      const key = this.keyFor(target.provider, target.model);
      let st = this.state.get(key);
      if (!st) {
        st = { lastProbedAt: this.processStartTime, inFlight: false };
        this.state.set(key, st);
      }

      if (st.inFlight) continue;
      if (now - st.lastProbedAt < thresholdMs) continue;

      // Fire-and-forget cooldown check + enqueue. Cooldown lookup is async;
      // we don't want to block the live-request path waiting on it. The
      // worker re-checks cooldown right before probing as well.
      const captured = st;
      this.tasks.track(
        cooldownMgr
          .isProviderHealthy(target.provider, target.model)
          .then((healthy) => {
            if (!healthy || this.shuttingDown) return;
            if (captured.inFlight) return;
            // Re-check staleness in case another trigger raced us.
            if (Date.now() - captured.lastProbedAt < thresholdMs) return;

            this.queue.push({ provider: target.provider!, model: target.model! });
            this.pumpWorkers();
          })
          .catch((err) => {
            logger.debug(
              `BackgroundExplorer: cooldown check failed for ${target.provider}/${target.model}: ${err?.message ?? err}`
            );
          })
      );
    }
  }

  private keyFor(provider: string, model: string): TargetKey {
    return `${provider}:${model}` as TargetKey;
  }

  private pumpWorkers(): void {
    if (this.shuttingDown) return;
    const config = getConfig();
    const bg = config.backgroundExploration;
    if (!bg || bg.enabled !== true) return;
    const concurrency = bg.workerConcurrency;

    while (this.activeWorkers < concurrency && this.queue.length > 0) {
      this.activeWorkers++;
      // Fire and forget; the worker manages its own lifecycle.
      void this.tasks.track(this.worker());
    }
  }

  private async worker(): Promise<void> {
    try {
      while (!this.shuttingDown && this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) break;

        const key = this.keyFor(next.provider, next.model);
        const st = this.state.get(key);
        if (!st) continue;

        if (st.inFlight) continue;

        // Final cooldown re-check immediately before dispatching the probe.
        const healthy = await CooldownManager.getInstance()
          .isProviderHealthy(next.provider, next.model)
          .catch(() => false);
        if (!healthy || this.shuttingDown) {
          logger.debug(
            `BackgroundExplorer: skipping probe for ${next.provider}/${next.model} — on cooldown`
          );
          continue;
        }

        st.inFlight = true;
        try {
          logger.debug(`BackgroundExplorer: probing ${next.provider}/${next.model}`);
          await this.probeService.runProbe({
            provider: next.provider,
            model: next.model,
            apiType: 'chat',
            source: 'background',
          });
        } catch (err: any) {
          // ProbeService.runProbe should never throw, but defend in depth.
          logger.debug(
            `BackgroundExplorer: probe threw for ${next.provider}/${next.model}: ${err?.message ?? err}`
          );
        } finally {
          st.lastProbedAt = Date.now();
          st.inFlight = false;
        }
      }
    } finally {
      this.activeWorkers--;
    }
  }

  /** Discard queued probes and wait for probes already producing usage records. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.queue.length = 0;
    await this.tasks.drain();
  }
}
