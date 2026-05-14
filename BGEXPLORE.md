# Background Exploration Plan

## Goal

Add an optional background exploration mode that keeps performance data
(TTFT / TPS / E2E TPS) fresh for the `latency`, `performance`, and
`e2e_performance` selectors **without** diverting live request traffic to
slower providers.

When enabled, the existing inline `Math.random() < explorationRate` branches in
those selectors are suppressed; instead, a separate background worker fires
representative synthetic probes at stale targets, and their results populate
the same `providerPerformance` table the selectors already read from.

The manual "test" path triggered from the management UI is folded into the
same probe machinery so there is exactly one canonical probe shape and code
path.

---

## Design summary

- **Trigger:** staleness-driven, gated on live requests. Each live request to
  an alias whose group is using one of the three perf-based selectors causes a
  check: any target in the active group whose `lastProbedAt` is older than
  `stalenessThresholdMs` is enqueued for a probe.
- **Bootstrap:** absent entries are treated as `process_start_time`. First
  probe fires at normal cadence once the threshold elapses, not eagerly on
  cold start.
- **Burst handling:** all stale targets are enqueued together. A bounded
  worker pool drains the queue. Per-target `inFlight` guard prevents
  duplicates. Existing `CooldownManager` is respected.
- **Probe shape:** one canonical, version-stamped synthetic `chat` request —
  moderate input, two stub tool definitions, `max_tokens: 1000`, streaming.
- **Probe path:** uses the existing `direct/<provider>/<model>` routing
  syntax, which pins to one specific target, skips alias resolution, and
  naturally exercises the same transformer + provider + storage path as live
  traffic.
- **Attribution:** `apiKey = 'probe'`, `attribution = 'manual' | 'background'`.
  Probes appear in user-facing usage records.
- **Unification with manual test:** the management test endpoint becomes a
  thin wrapper over the same `ProbeService.runProbe()` used by the background
  worker.

---

## Components

### 1. Config (`packages/backend/src/config.ts`)

Add a new top-level block to `RawPlexusConfigSchema`:

```ts
const BackgroundExplorationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  stalenessThresholdMs: z.number().int().min(1000).default(600_000), // 10 min
  workerConcurrency: z.number().int().min(1).max(16).default(2),
});

// inside RawPlexusConfigSchema.object({...})
backgroundExploration: BackgroundExplorationConfigSchema.optional(),
```

The three existing inline-exploration fields are **not** removed:

- `performanceExplorationRate`
- `latencyExplorationRate`
- `e2ePerformanceExplorationRate`

They continue to drive the existing inline exploration. The new mode merely
**suppresses** them at runtime when `backgroundExploration.enabled === true`.

### 2. Selectors

Files:
- `packages/backend/src/services/selectors/performance.ts`
- `packages/backend/src/services/selectors/e2e-performance.ts`
- `packages/backend/src/services/selectors/latency.ts`

In each, wrap the existing `Math.random() < explorationRate` block:

```ts
const bgEnabled = config.backgroundExploration?.enabled === true;
if (!bgEnabled && explorationRate > 0 && Math.random() < explorationRate && ...) {
  // existing exploration logic, unchanged
}
```

No other logic changes. `pickExplorationTarget` in `base.ts` remains in use
for the inline (non-background) path.

### 3. Probe shape (`packages/backend/src/services/probe-request.ts`, new)

Exports:

```ts
export const PROBE_SHAPE_VERSION = 1;

export function buildProbeChatRequest(provider: string, model: string): unknown;
```

Returned object is the **raw inbound chat payload** (the OpenAI-style body the
existing `OpenAITransformer.parseRequest` consumes), parameterised with
`model = direct/${provider}/${model}`.

Shape:

- `model: 'direct/<provider>/<model>'`
- `stream: true`
- `max_tokens: 1000`
- `messages`:
  - `system` (~200 tokens): instructive persona priming text. Stable, checked
    in as a constant.
  - `user` (~150 tokens): asks for a brief reasoned answer and, when
    appropriate, a tool call decision. Stable.
- `tools`: two stub function definitions (e.g. `get_weather`, `search_docs`)
  with realistic JSON-schema parameters. Stable.

The shape constants live alongside `PROBE_SHAPE_VERSION` so any future change
bumps the version.

> Non-chat API types keep their existing trivial `TEST_TEMPLATES` shapes for
> manual-test UI debugging. The background explorer only ever uses the
> `chat` shape.

### 4. ProbeService (`packages/backend/src/services/probe-service.ts`, new)

Single entry point used by both the management test endpoint and the
background worker.

```ts
type ProbeSource = 'manual' | 'background';
type ProbeApiType =
  | 'chat' | 'messages' | 'gemini' | 'responses'
  | 'embeddings' | 'images' | 'speech' | 'oauth';

interface RunProbeArgs {
  provider: string;
  model: string;
  apiType: ProbeApiType;
  source: ProbeSource;
}

class ProbeService {
  constructor(dispatcher: Dispatcher, usageStorage: UsageStorageService);
  async runProbe(args: RunProbeArgs): Promise<{
    success: boolean;
    durationMs: number;
    response?: unknown;
    error?: { message: string; statusCode?: number };
  }>;
}
```

Responsibilities (mirrors the current `test.ts` flow):

1. Generate `requestId`. Construct initial `UsageRecord`:
   - `apiKey = 'probe'`
   - `attribution = source`             // 'manual' | 'background'
   - `incomingModelAlias = 'direct/<provider>/<model>'`
   - `incomingApiType = apiType`
   - `sourceIp = null` (no client IP for probes)
   - emits `started` event via `usageStorage.emitStartedAsync(...)`
2. Build the request body:
   - For `apiType === 'chat'`: `buildProbeChatRequest(provider, model)`.
   - For other types: use the existing per-type templates lifted from
     `routes/management/test.ts` (same shapes, unchanged).
3. Run it through the appropriate transformer / dispatcher path, exactly
   matching the current `test.ts` logic:
   - chat / messages / gemini / responses → corresponding transformer →
     `dispatcher.dispatch`
   - embeddings → `dispatcher.dispatchEmbeddings`
   - images → `dispatcher.dispatchImageGenerations`
   - speech → `SpeechTransformer.parseRequest` → `dispatcher.dispatchSpeech`
   - oauth → hand-built unified request → `dispatcher.dispatch`
   - transcriptions → unsupported (matches current behavior)
4. Finalise `UsageRecord` from the dispatch response (provider, model,
   tokens, cost, ttft, attempt count, retry history, etc.) — same projection
   the current `test.ts` does.
5. Persist usage record via the normal usage storage path. Performance
   metrics (`providerPerformance`) are recorded by the dispatcher itself, so
   no extra plumbing is required for that.
6. Return `{ success, durationMs, response | error }` to the caller.

The service is constructed once at startup (alongside other singletons) and
shared between the management route and the background explorer.

### 5. Management test route (`packages/backend/src/routes/management/test.ts`)

Refactor to a thin wrapper:

- Parse + validate body (`provider`, `model`, `apiType`).
- Call `probeService.runProbe({ provider, model, apiType, source: 'manual' })`.
- Map the result to the HTTP response shape the UI already expects.
- Remove the inlined request building / transformer dispatch / usage record
  construction (now lives in `ProbeService`).

Behaviour change: the resulting usage record's `apiKey` is `'probe'` instead
of the caller's key. Documented.

### 6. Background explorer (`packages/backend/src/services/background-explorer.ts`, new)

Singleton.

State:

```ts
type TargetKey = `${string}:${string}`; // `${provider}:${model}`

interface TargetState {
  lastProbedAt: number;   // ms epoch; initialised to processStartTime on first sight
  inFlight: boolean;
}

private state: Map<TargetKey, TargetState>;
private queue: Array<{ provider: string; model: string }>;
private processStartTime: number;
private activeWorkers: number;
```

Public API:

```ts
class BackgroundExplorer {
  static getInstance(): BackgroundExplorer;
  static initialize(probeService: ProbeService): void;
  static resetForTesting(): void;

  /**
   * Non-blocking. Inspects each target in the group, enqueues any that are
   * stale, healthy, and not currently in flight. Returns immediately.
   */
  maybeTrigger(group: ModelTargetGroup): void;
}
```

Behaviour:

- `maybeTrigger` short-circuits if `config.backgroundExploration?.enabled !== true`.
- For each `target` in `group.targets` (only enabled, non-disabled-provider
  targets, matching the filtering router does):
  - Look up or initialise `state[provider:model]` with
    `lastProbedAt = processStartTime`, `inFlight = false`.
  - Skip if `state.inFlight`.
  - Skip if `now - state.lastProbedAt < stalenessThresholdMs`.
  - Skip if `!CooldownManager.getInstance().isProviderHealthy(provider, model)`.
  - Otherwise enqueue.
- After enqueueing, calls `pumpWorkers()` which spawns workers up to
  `workerConcurrency`.
- A worker:
  1. Dequeues `{ provider, model }`.
  2. Sets `state.inFlight = true`.
  3. Re-checks cooldown (race-safe). If on cooldown, abort, clear `inFlight`.
  4. `await probeService.runProbe({ provider, model, apiType: 'chat', source: 'background' })`.
  5. Regardless of success/failure: `state.lastProbedAt = Date.now()`,
     `state.inFlight = false`.
  6. Logs result at debug level. Errors are swallowed (probe failures must
     never affect live traffic).
  7. Loops to drain queue.

Note: `lastProbedAt` is updated even on probe failure. A failing target will
back off naturally because `CooldownManager` will mark it unhealthy after
real-traffic failures; we don't want a hard-failing target re-probed on every
live request.

### 7. Router trigger wiring (`packages/backend/src/services/router.ts`)

Two call sites where target selection completes against a known
`ModelTargetGroup`:

1. The `selectOrderedTargets` path inside `Router.resolveCandidates`
   (both the direct-group branch around line 226 and the normal alias
   branch around line 274).
2. The single-selector path inside `Router.resolve` (the direct-group branch
   around line 328 and the normal alias branch around line 388).

At each site, immediately **after** a successful selection (i.e. we have an
`alias` + `group` in scope), call:

```ts
BackgroundExplorer.getInstance().maybeTrigger(group);
```

Guards:

- The method itself is a no-op when `backgroundExploration.enabled !== true`.
- The method is a no-op for groups whose `selector` is not one of
  `'latency' | 'performance' | 'e2e_performance'` (other selectors don't
  consume performance data, so probes would be pointless cost).
- Recursion: probe requests use `model: 'direct/<provider>/<model>'` which
  bypasses alias resolution entirely. `findAlias` returns no alias, so the
  alias-and-group branches are not entered; `maybeTrigger` is therefore not
  called for probe requests. An explicit guard is not required but a
  defensive check on `incomingModelAlias?.startsWith('direct/')` will be
  added for clarity.

### 8. Usage storage

No schema change in v1.

- `apiKey = 'probe'` and `attribution = 'manual' | 'background'` are stored
  on existing columns.
- `providerPerformance` rows are written by the existing dispatcher path with
  no changes; probe results pool with live-traffic results.

A future schema change to add an explicit `isProbe` boolean (so dashboards
can filter cleanly without string matching) is noted as **out of scope for
v1** but easy to add.

### 9. Startup wiring (`packages/backend/src/index.ts` or equivalent)

After `Dispatcher` and `UsageStorageService` are constructed:

```ts
const probeService = new ProbeService(dispatcher, usageStorage);
BackgroundExplorer.initialize(probeService);
```

Replace the existing direct construction of `ProbeService` consumers
(management test route) so they receive the shared instance via DI.

---

## Files touched

**New:**
- `packages/backend/src/services/probe-request.ts`
- `packages/backend/src/services/probe-service.ts`
- `packages/backend/src/services/background-explorer.ts`

**Modified:**
- `packages/backend/src/config.ts` — add `backgroundExploration` schema.
- `packages/backend/src/services/selectors/performance.ts` — gate inline
  exploration on `!backgroundExploration.enabled`.
- `packages/backend/src/services/selectors/e2e-performance.ts` — same.
- `packages/backend/src/services/selectors/latency.ts` — same.
- `packages/backend/src/services/router.ts` — add `maybeTrigger` calls at
  four post-selection sites.
- `packages/backend/src/routes/management/test.ts` — collapse to thin
  wrapper over `ProbeService.runProbe`.
- `packages/backend/src/index.ts` (or wherever the dispatcher singleton is
  wired today) — construct `ProbeService` and initialise
  `BackgroundExplorer`.

---

## Tests

Following the project's `__tests__/` convention and `vitest` skill rules.

### Unit tests

- `services/selectors/__tests__/performance.test.ts`,
  `e2e-performance.test.ts`,
  `latency.test.ts` — add cases asserting that when
  `config.backgroundExploration.enabled === true`, inline exploration does
  **not** occur (deterministic "always pick best"), and when it is `false`
  the existing behaviour is preserved.
- `services/__tests__/background-explorer.test.ts` (new):
  - `maybeTrigger` is a no-op when disabled in config.
  - `maybeTrigger` is a no-op for non-perf selector groups.
  - Stale + healthy targets get enqueued; non-stale targets do not.
  - Targets on cooldown are skipped.
  - `inFlight` prevents duplicate enqueue while a probe is running.
  - `workerConcurrency` cap is honoured.
  - `lastProbedAt` is updated on both success and failure of the probe.
  - Probe failures are swallowed and do not throw out of `maybeTrigger`.
- `services/__tests__/probe-service.test.ts` (new):
  - Builds the correct `direct/<provider>/<model>` request.
  - Sets `apiKey = 'probe'` and `attribution` from `source`.
  - Returns success/failure shape correctly.
  - Dispatches via the correct method per `apiType`.

### Integration test (lightweight)

- `test/integration/background-exploration.test.ts` (new):
  - With a mocked dispatcher and one alias using `performance` selector,
    a live request triggers a probe for a stale target; that probe's
    completion writes a `providerPerformance` row attributable to the
    probe target.
  - Live request itself is unaffected.

`registerSpy` from `test/test-utils.ts` is used in lieu of raw `vi.spyOn`.
Singletons (`BackgroundExplorer`) expose `resetForTesting()` and are reset
in `beforeEach`.

---

## Rollout / defaults

- `backgroundExploration.enabled` defaults to `false`. Existing deployments
  see zero behaviour change until they opt in.
- Defaults when enabled: `stalenessThresholdMs = 600_000` (10 min),
  `workerConcurrency = 2`.

---

## Out of scope (future)

- Per-alias `backgroundExploration` overrides.
- Budget-bounded exploration (cost / count caps per hour or day).
- `isProbe` boolean column on `requestUsage` / `providerPerformance` for
  cleaner dashboard filtering.
- Versioned probe-shape invalidation in `providerPerformance` (only matters
  when `PROBE_SHAPE_VERSION` increments).
- Per-target probe-shape variants (e.g. larger context for long-context
  models).
