# Implementation Plan: Auto-Routing Classifier Model

## Overview

This implements a **request complexity classifier** as a reserved `auto` model in Plexus. When a client sends a request with `model: "auto"`, the Router intercepts it, classifies the request's complexity via the local 5-phase scoring pipeline, optionally boosts the tier based on `agenticScore`, then re-resolves routing against the tier-mapped model alias — all before any provider dispatch occurs.

---

## Architecture Decision Summary

| Decision | Choice |
|---|---|
| Intercept point | **Router** — `Router.resolve` / `Router.resolveCandidates` detect `"auto"` and reclassify |
| HEARTBEAT tier | **Dedicated model alias** in config |
| agenticScore behavior | **One tier promotion** if score > configurable threshold |
| YAML config | **New top-level `auto:` block** with full `ClassifierConfig` fields |
| Dimension weights | **All 16 required** if `dimensionWeights` key is present |
| DB logging | **New `classifier_log` table** (both SQLite + PostgreSQL migrations) |
| Auto model name | **Fixed reserved string `"auto"`** — no model entry needed in `models:` |

---

## File Structure — New Files to Create

```
packages/backend/src/
  classifier/
    types.ts          ← Tier enum, ClassifierInput, ClassificationResult,
                DimensionScore, ClassifierConfig interfaces
    keywords.ts       ← All 11 keyword arrays (CODE_KEYWORDS, etc.)
    config.ts         ← DEFAULT_CLASSIFIER_CONFIG, deep-merge utility
    phase1.ts       ← Short-circuit checks (heartbeat, forced tier, token overflow)
    dimensions.ts     ← All 16 dimension scorer functions
    scoring.ts        ← Weighted sum, Phase 3 overrides, Phase 4 boundary mapping,
                  Phase 5 sigmoid confidence + ambiguity
    index.ts          ← export classify(input, config?) function

drizzle/schema/
  sqlite/
    classifier-log.ts   ← New SQLite table
  postgres/
    classifier-log.ts   ← New PostgreSQL table
```

---

## File Structure — Files to Modify

```
packages/backend/src/
  config.ts                    ← Add AutoConfig Zod schema + top-level auto: key
  services/router.ts              ← Intercept "auto" model in resolve() + resolveCandidates()
  db/types.ts                       ← Add ClassifierLog types (inferred from schema)
  services/usage-storage.ts         ← Add saveClassifierLog() method

drizzle/schema/
  index.ts                    ← Export new classifierLog table (sqlite + postgres)

config/plexus.yaml                  ← Add example auto: block
```

---

## Detailed Step-by-Step Plan

### Step 1: Implement the Classifier Library

**`packages/backend/src/classifier/types.ts`**

Define all TypeScript interfaces exactly as in CLASSIFIER.md §4:

```typescript
export enum Tier {
  HEARTBEAT  = "HEARTBEAT",
  SIMPLE     = "SIMPLE",
  MEDIUM     = "MEDIUM",
  COMPLEX    = "COMPLEX",
  REASONING  = "REASONING",
}

export const TIER_RANK: Record<Tier, number> = {
  HEARTBEAT: 0, SIMPLE: 1, MEDIUM: 2, COMPLEX: 3, REASONING: 4,
};

export interface ClassifierInput { messages: ...; tools?: ...; tool_choice?: ...; response_format?: ...; max_tokens?: number; }
export interface DimensionScore { name: string; score: number; signal: string | null; }
export interface ClassificationResult { tier, score, confidence, method, reasoning, signals, agenticScore, hasStructuredOutput }
export interface ClassifierConfig { maxTokensForceComplex, dimensionWeights, tierBoundaries, confidenceSteepness, ambiguityThreshold, ambiguousDefaultTier, reasoningOverrideMinMatches, ..., keywords }
```
**`packages/backend/src/classifier/keywords.ts`**

All 11 keyword arrays from CLASSIFIER.md §11 (CODE_KEYWORDS, REASONING_KEYWORDS, SIMPLE_KEYWORDS, TECHNICAL_KEYWORDS, CREATIVE_KEYWORDS, AGENTIC_KEYWORDS, IMPERATIVE_KEYWORDS, CONSTRAINT_KEYWORDS, OUTPUT_FORMAT_KEYWORDS, REFERENCE_KEYWORDS, NEGATION_KEYWORDS).

**`packages/backend/src/classifier/config.ts`**

`DEFAULT_CLASSIFIER_CONFIG` object from CLASSIFIER.md §12. Deep-merge utility:

```typescript
export function mergeConfig(partial: Partial<ClassifierConfig>): ClassifierConfig {
  return {
    ...DEFAULT_CLASSIFIER_CONFIG,
    ...partial,
    tierBoundaries: { ...DEFAULT_CLASSIFIER_CONFIG.tierBoundaries, ...partial.tierBoundaries },
    keywords: { ...DEFAULT_CLASSIFIER_CONFIG.keywords, ...partial.keywords },
    dimensionWeights: partial.dimensionWeights ?? DEFAULT_CLASSIFIER_CONFIG.dimensionWeights,
  // Note: dimensionWeights must be fully specified if provided (all 16 keys)
  };
}
```

**`packages/backend/src/classifier/phase1.ts`**

- `extractLastUserMessage(messages)` — backward scan, multimodal text concat
- `estimateTokens(messages)` — 4-char heuristic
- `detectHeartbeat(lastUserMessage, messages, hasTools)` — regex patterns + length check
- `detectForcedTier(lastUserMessage)` — `/\bUSE\s+(HEARTBEAT|SIMPLE|MEDIUM|COMPLEX|REASONING)\b/i`
- `detectTokenOverflow(estimatedTokens, threshold)` — > `maxTokensForceComplex`
- `runPhase1(input, config)` — returns `ClassificationResult | null`

**`packages/backend/src/classifier/dimensions.ts`**

All 16 pure functions with signatures:

```typescript
function scoreTokenCount(estimatedTokens: number, config: ClassifierConfig): DimensionScore
function scoreCodePresence(fullText: string, config: ClassifierConfig): DimensionScore
// ... etc for all 16
```

`scoreDimensions()` also returns side-effect values (`agenticScore`, `hasStructuredOutput`, `reasoningMatches`) alongside the `DimensionScore[]` array.

**`packages/backend/src/classifier/scoring.ts`**

- `computeWeightedScore(dimensions, weights)` — Phase 2 aggregation
- `runPhase3Overrides(...)` — reasoning override, architecture override, structured-output flag
- `mapToBoundary(weightedScore, boundaries)` — Phase 4 boundary lookup + `distanceFromBoundary`
- `calibrateConfidence(distance, steepness)` — sigmoid
- `runPhase5(...)` — confidence + ambiguity fallback
- `applyAgenticBoost(tier, agenticScore, threshold)` — if `agenticScore > threshold`, promote one tier (e.g. SIMPLE→MEDIUM, up to REASONING max)

**`packages/backend/src/classifier/index.ts`**

```typescript
export function classify(input: ClassifierInput, config?: Partial<ClassifierConfig>): ClassificationResult
```

Chains all phases in order. Synchronous, no external calls.

---

### Step 2: Add Database Schema

**`packages/backend/drizzle/schema/sqlite/classifier-log.ts`**

```typescript
export const classifierLog = sqliteTable('classifier_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id').notNull(),
  tier: text('tier').notNull(),
  score: real('score').notNull(),
  confidence: real('confidence').notNull(),
  method: text('method').notNull(),         // "short-circuit" | "rules"
  reasoning: text('reasoning').notNull(),
  signals: text('signals').notNull(),        // JSON array stringified
  agenticScore: real('agentic_score').notNull(),
  hasStructuredOutput: integer('has_structured_output').notNull(),  // 0 | 1
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  requestIdIdx: index('idx_classifier_log_request_id').on(table.requestId),
  createdAtIdx: index('idx_classifier_log_created_at').on(table.createdAt),
}));
```

**`packages/backend/drizzle/schema/postgres/classifier-log.ts`**

Same structure using `pgTable`, `serial`, `varchar`, `real`, `bigint`, `boolean`.

**`packages/backend/drizzle/schema/index.ts`**

Add exports for both:

```typescript
export * from './sqlite/classifier-log';
export { classifierLog as pgClassifierLog } from './postgres/classifier-log';
```

**Generate migrations (both databases):**

```bash
cd packages/backend
bunx drizzle-kit generate
bunx drizzle-kit generate --config drizzle.config.pg.ts
```

---

### Step 3: Add DB Types + Storage Method

**`packages/backend/src/db/types.ts`**

Add:

```typescript
export type ClassifierLogRecord = InferSelectModel<typeof schema.classifierLog>;
export type NewClassifierLogRecord = InferInsertModel<typeof schema.classifierLog>;
```

**`packages/backend/src/services/usage-storage.ts`**

Add method:

```typescript
async saveClassifierLog(record: NewClassifierLogRecord): Promise<void>
```
Inserts into `classifierLog` table.

---

### Step 4: Add `auto:` Configuration to `config.ts`

**Schema additions in `packages/backend/src/config.ts`:**

```typescript
const AutoTierModelsSchema = z.object({
  heartbeat: z.string().min(1),
  simple: z.string().min(1),
  medium: z.string().min(1),
  complex: z.string().min(1),
  reasoning: z.string().min(1),
});

const ClassifierDimensionWeightsSchema = z.object({
  tokenCount: z.number().min(0),
  codePresence: z.number().min(0),
  reasoningMarkers: z.number().min(0),
  multiStepPatterns: z.number().min(0),
  simpleIndicators: z.number().min(0),
  technicalTerms: z.number().min(0),
  agenticTask: z.number().min(0),
  toolPresence: z.number().min(0),
  questionComplexity: z.number().min(0),
  creativeMarkers: z.number().min(0),
  constraintCount: z.number().min(0),
  outputFormat: z.number().min(0),
  conversationDepth: z.number().min(0),
  imperativeVerbs: z.number().min(0),
  referenceComplexity: z.number().min(0),
  negationComplexity: z.number().min(0),
}).strict(); // all 16 required if key is present

const AutoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tier_models: AutoTierModelsSchema,
  agentic_boost_threshold: z.number().min(0).max(1).default(0.8),
  classifier: z.object({
    maxTokensForceComplex: z.number().optional(),
    dimensionWeights: ClassifierDimensionWeightsSchema.optional(),
  tierBoundaries: z.object({
      simpleMedium: z.number().optional(),
      mediumComplex: z.number().optional(),
      complexReasoning: z.number().optional(),
    }).optional(),
    confidenceSteepness: z.number().optional(),
    ambiguityThreshold: z.number().optional(),
    ambiguousDefaultTier: z.enum(['HEARTBEAT','SIMPLE','MEDIUM','COMPLEX','REASONING']).optional(),
    reasoningOverrideMinMatches: z.number().int().optional(),
    reasoningOverrideMinConfidence: z.number().optional(),
    reasoningOverrideMinScore: z.number().optional(),
    architectureOverrideConfidence: z.number().optional(),
    architectureOverrideMinScore: z.number().optional(),
  }).optional(),
});
```

Add `auto: AutoConfigSchema.optional()` to `RawPlexusConfigSchema`.

Export `AutoConfig = z.infer<typeof AutoConfigSchema>`.

---

### Step 5: Intercept in Router

**`packages/backend/src/services/router.ts`**

Add a helper function `isAutoModel(modelName: string): boolean` that returns `modelName === 'auto'`.

**Key architectural change:** The Router currently receives only `modelName` and `incomingApiType`. The classifier needs the full `messages`, `tools`, `tool_choice`, `response_format`, and `max_tokens`.

**Resolution:** Extend `Router.resolve()` and `Router.resolveCandidates()` to accept an optional `requestContext?: Pick<UnifiedChatRequest, 'messages' | 'tools' | 'tool_choice' | 'response_format' | 'max_tokens'>` parameter. The Dispatcher, which already has the full `UnifiedChatRequest`, passes this when calling the Router.

**`Router.resolveAutoModel()` (private static method):**

1. Load `config.auto` from `getConfig()`. If not present or `enabled: false`, throw `"auto model not configured"`.
2. Build `ClassifierInput` from `requestContext`.
3. Build `ClassifierConfig` by merging `config.auto.classifier` overrides with `DEFAULT_CLASSIFIER_CONFIG`.
4. Call `classify(classifierInput, classifierConfig)` → `ClassificationResult`.
5. Apply agentic boost: if `result.agenticScore > config.auto.agentic_boost_threshold`, promote tier one step (capped at REASONING).
6. Map boosted tier to model alias from `config.auto.tier_models`.
7. Log classification result via `logger.debug(...)`.
8. Async (fire-and-forget): save `ClassifierLog` record to DB if `requestId` is available — requestId is not available in the Router, so logging is deferred or passed in as an optional param.
9. Call `Router.resolve(tierModelAlias, incomingApiType)` and return the result.

For `resolveCandidates()`, apply the same pattern: if model is `"auto"`, run classifier and re-resolve using the tier-mapped alias.

> **Note on requestId for DB logging:** The Router does not have access to `requestId`. Two options: (a) pass `requestId` as an additional optional parameter alongside `requestContext`, or (b) have the Dispatcher save the classifier log after calling the Router (the Dispatcher has both the request and can receive the classification result back via metadata on the RouteResult or a side-channel). The cleaner solution is to pass `requestId` as an optional parameter to `resolveAutoModel`.

---

### Step 6: Thread `requestContext` Through Dispatcher → Router

**`packages/backend/src/services/dispatcher.ts`** — `dispatch()` method:

When calling `Router.resolveCandidates` and `Router.resolve`, pass the full request as the optional context:

```typescript
let candidates = await Router.resolveCandidates(
  request.model,
  request.incomingApiType,
  request   // pass full request as optional requestContext
);
```

Same for the `Router.resolve()` fallback call.

---

### Step 7: Example `plexus.yaml` Config

```yaml
auto:
  enabled: true
  tier_models:
    heartbeat: fast-small      # alias for a very cheap model (e.g. haiku)
    simple: fast-small         # same cheap model works for simple
    medium: balanced           # alias for a mid-tier model (e.g. sonnet)
    complex: powerful          # alias for a capable model (e.g. claude-3-5-sonnet)
    reasoning: reasoning       # alias for a reasoning-optimized model (e.g. o3-mini)
  agentic_boost_threshold: 0.8  # promote one tier if agenticScore > this
  classifier:
    tierBoundaries:
      simpleMedium: 0.00
      mediumComplex: 0.20
      complexReasoning: 0.40
    confidenceSteepness: 12
    ambiguityThreshold: 0.55
    maxTokensForceComplex: 100000
    # dimensionWeights: (omit to use defaults — or specify ALL 16 if overriding)
```

---

### Step 8: Write Tests

**`packages/backend/test/classifier/`**

Following the project's Bun test conventions (`bunfig.toml` preloads `test/setup.ts`):

- `phase1.test.ts` — heartbeat patterns (all 6 regex + length fallback), forced tier (5 tiers, case-insensitive), token overflow (at/above/below threshold)
- `dimensions.test.ts` — each of the 16 dimensions tested in isolation: 0 matches, low matches, high matches; verify exact `score` and `signal` values
- `scoring.test.ts` — weighted sum correctness, override checks, boundary mapping, sigmoid calibration, ambiguity fallback
- `classifier.test.ts` — full integration: all 6 worked examples from CLASSIFIER.md §13 must match documented tier/score/signals within ±0.01
- `auto-router.test.ts` — mock `getConfig()` to return `auto:` config; verify that `Router.resolve("auto", ...)` with a simple message resolves to `tier_models.simple` alias; verify agentic boost promotes tier correctly

---

### Step 9: Format and Verify
```bash
cd packages/backend
bun run format
bun test test/classifier/
```

---

## Implementation Order (Recommended Sequence)

| # | Task | Files Changed |
|---|---|---|
| 1 | Classifier library (types, keywords, config, phases, dimensions, scoring, index) | `src/classifier/*` (new) |
| 2 | DB schema files (SQLite + PostgreSQL) | `drizzle/schema/sqlite/classifier-log.ts`, `drizzle/schema/postgres/classifier-log.ts` |
| 3 | Update `drizzle/schema/index.ts` exports | `drizzle/schema/index.ts` |
| 4 | Generate migrations | Run `drizzle-kit generate` twice |
| 5 | DB types + storage method | `src/db/types.ts`, `src/services/usage-storage.ts` |
| 6 | Config schema additions | `src/config.ts` |
| 7 | Router intercept + `resolveAutoModel()` + extended signatures | `src/services/router.ts` |
| 8 | Dispatcher thread-through | `src/services/dispatcher.ts` |
| 9 | Update `plexus.yaml` example | `config/plexus.yaml` |
| 10 | Tests | `test/classifier/*` |
| 11 | Format | `bun run format` |

---

## Key Design Decisions

1. **Classifier is pure**: no async, no I/O, no side effects. The `classify()` function is a deterministic `< 1ms` local computation.

2. **Router is the intercept point**: `Router.resolve("auto")` and `Router.resolveCandidates("auto")` receive an optional `requestContext` and trigger classification before re-resolving against the tier-mapped alias. The rest of the dispatch pipeline (transformer selection, provider call, response handling) runs normally against the resolved alias.

3. **agenticBoost is applied after classification**: if `agenticScore > agentic_boost_threshold`, the tier is promoted one step (SIMPLE→MEDIUM, MEDIUM→COMPLEX, etc.) before alias lookup. This happens in `resolveAutoModel()`, not inside the classifier itself.

4. **Config is fully additive**: no existing config keys change. The new `auto:` top-level block is entirely optional — if absent, requesting model `"auto"` throws a clear error.

5. **All 16 dimension weights required if overriding**: if `classifier.dimensionWeights` is present in YAML, all 16 keys must be specified (validated by Zod `.strict()`). Partial weight overrides are not supported to prevent accidental weight mis-sums.

6. **DB logging is fire-and-forget**: `saveClassifierLog()` is called asynchronously and does not block the routing path. Log failures are caught and logged at `warn` level only.

7. **requestId threading**: `requestId` is passed as an optional parameter into `Router.resolveAutoModel()` alongside `requestContext`, enabling classifier log DB writes from within the Router without requiring architectural changes to the Dispatcher's return path.
