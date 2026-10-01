# Auto model routing implementation plan

## Status and scope

This is an implementation plan, not an implemented feature. The agreed product is a regular
alias routing policy named `auto`. Clients request an alias such as `my-magic-model`; Plexus
selects from that alias's configured targets using typed Jev/Decisions judgments and a
deterministic, cache-aware switching policy.

The Models UI must support per-target capability, specialties, and reasoning suitability,
plus alias-level scoring thresholds and switching controls. Configuration must round-trip
through the management API and database, not exist only in the browser.

Borrow techniques, not source code, from
[pi-jev-model-router](https://github.com/da-vinci-noob/pi-jev-model-router). The reference was
reviewed at commit `f1a6f0381ef10899319542525f4d53c76c368396`. Its useful ideas are constrained
task judgments, local economic policy, continuation heuristics, candidate chains, switch
penalties, and hysteresis. Its weights and cache assumptions are not validated defaults for
Plexus.

### Agreed requirements

- Add `auto` alongside existing routing policies. Do not build a separate global router.
- Select only configured targets reachable from the requested alias.
- Keep capability metadata local to each configured target, including alias-reference targets.
- Let administrators edit alias-level scoring and switching thresholds in the UI.
- Classify once per inference request, not once per candidate or retry.
- Keep task judgment independent of model prices, permissions, and current budget pressure.
- Preserve existing access, quota, admission, cancellation, and failover controls.
- When no target meets the inferred capability requirement, select the first eligible option
  in configured list order. This fallback does not bypass access or protocol constraints.
- Treat Responses continuations like other requests, with no Responses-specific routing exception.
- Price this request's likely cache behavior before making marginal model switches.
- Record decisions sufficiently to explain and replay the local policy.
- Provide a routing preview that can recompute policy without paying for another judgment.

### Non-goals for the first release

- A global pool of models outside the alias's target graph.
- Learned capability rankings, automatic benchmark ingestion, or RouteLLM deployment.
- Semantic matching of cached judgments. Start with exact context fingerprints.
- Prediction of how many future turns a conversation will have.
- Transparent migration of provider-bound tool/reasoning/native Responses state.
- Automatic rewriting of client reasoning settings or generation parameters.
- A new general-purpose spending-cap system. Existing quota controls remain authoritative.
- Changes to embeddings, images, speech, transcription, or Decisions routing behavior.

## Current implementation and implications

| Area | Current source | Required change |
| --- | --- | --- |
| Alias configuration | [config.ts](../../packages/backend/src/config.ts) | Extend the selector enum, target metadata, and alias policy schema |
| Candidate building | [router.ts](../../packages/backend/src/services/routing/router.ts) | Preserve group and target provenance; support deferred request-aware auto ordering |
| Selector interface | [base.ts](../../packages/backend/src/services/routing/selectors/base.ts) | Keep ordinary selectors working; do not invoke classification in the repeated single-target loop |
| Selector registry | [factory.ts](../../packages/backend/src/services/routing/selectors/factory.ts) | Recognize auto as request-aware policy rather than falling through to an unsupported selector |
| Access/quota filtering | [route-candidates.ts](../../packages/backend/src/services/routing/route-candidates.ts) | Complete filtering before auto makes its final selection |
| Dispatch | [request-manager.ts](../../packages/backend/src/services/dispatch/request-manager.ts) | Consume the policy's ordered candidates before attempts begin |
| Sticky state | [sticky-session-manager.ts](../../packages/backend/src/services/routing/sticky-session-manager.ts) | Separate incumbent preference from hard continuation affinity and measured warmth |
| Cache-key injection | [cache-key-injection.ts](../../packages/backend/src/services/dispatch/cache-key-injection.ts) | Coordinate stable identity without equating an injected key with a cache hit |
| Decisions contract | [decisions.ts](../../packages/backend/src/types/decisions.ts) | Validate required answers and rubric-specific values in the auto consumer |
| Classifier dispatch | [media-dispatcher.ts](../../packages/backend/src/services/dispatch/media-dispatcher.ts) | Reuse internal Decisions execution with recursion protection and child accounting |
| Alias persistence | [alias-repository.ts](../../packages/backend/src/db/alias-repository.ts) | Persist and reconstruct all new fields transactionally |
| Alias CRUD | [management/config.ts](../../packages/backend/src/routes/management/config.ts) | Validate saves and preserve policy through cache rebuilds |
| Frontend types | [aliases.ts](../../packages/frontend/src/types/aliases.ts) | Mirror backend policy and target metadata |
| Frontend serialization | [api/aliases.ts](../../packages/frontend/src/lib/api/aliases.ts) | Preserve new fields on read, edit, save, and reload |
| Group/target UI | [TargetGroupEditor.tsx](../../packages/frontend/src/components/models/TargetGroupEditor.tsx) | Add auto selection and per-target controls |
| Alias editor | [Models.tsx](../../packages/frontend/src/pages/Models.tsx) | Add alias-level policy controls and preview |
| Policy labels | [selectors.ts](../../packages/frontend/src/lib/selectors.ts) | Add the Auto label |
| API documentation | [AliasConfig.yaml](../openapi/components/schemas/AliasConfig.yaml) | Document auto, target profiles, and alias-reference shapes touched by this feature |

Important constraints from the current code:

1. Ordinary selectors receive targets only and are called repeatedly to build an ordering.
   Auto needs request-level evaluation that produces the whole ordering in one pass.
2. Sticky routing currently hoists the previous healthy target after selector ordering.
   That must not undo an auto upgrade or economic switch.
3. Access and quota filters run after initial alias resolution. Auto's final decision must
   use the filtered candidates; provider admission still runs just before each attempt.
4. Alias references are currently expanded after concrete targets. Auto must treat them
   as explicitly ranked logical targets, not automatically subordinate fallback entries.
5. Existing target rows have no location for capability metadata. Existing alias group JSON
   is narrowed to name and selector on save. Frontend serializers also discard unknown fields.
6. Sticky state has no TTL or authenticated API-key scope. It is not sufficient evidence for
   cache warmth or safe shared adaptive state.
7. Cache injection deliberately avoids `previousResponseId` as a stable conversation key.
   That ID changes between turns. Preserve existing cache-key behavior without excluding
   Responses requests from auto or forcing them to baseline routing.

## Configuration contract

Use the existing `target_groups[].selector` field for `auto`. Place scoring and switching
settings in an alias-scoped `auto_routing` object. Place local target qualifications in
`targets[].auto_profile`. Names below are proposed API names, not existing fields.

This example shows the intended shape. All numeric settings are provisional starting values,
not claims about classifier accuracy or provider latency.

```yaml
models:
  my-magic-model:
    type: text
    sticky_session: true
    auto_routing:
      mode: active
      classifier_alias: routing-judge
      classifier_deadline_ms: 500
      rubric_version: 1
      baseline_policy: in_order
      uncertainty_minimum_tier: high
      scoring:
        complexity_weight: 0.55
        capability_weight: 0.45
        reasoning_threshold: 0.65
        reasoning_boost: 0.5
        confidence_threshold: 0.6
        tier_boundaries:
          standard: 0.75
          high: 1.75
          premium: 2.5
        task_minimum_tiers:
          plan: high
          review: high
      preferences:
        specialty_bonus: 0.1
        reasoning_bonus: 0.1
      switching:
        score_deadband: 0.2
        minimum_savings_usd: 0.01
        minimum_savings_fraction: 0.1
        preference_margin: 0.05
    target_groups:
      - name: Main
        selector: auto
        targets:
          - provider: provider-a
            model: fast-model
            auto_profile:
              capability: standard
              specialties: [explain, chat, operate]
              reasoning: normal
          - provider: provider-b
            model: coding-model
            auto_profile:
              capability: high
              specialties: [implement, debug, refactor]
              reasoning: preferred
          - alias: premium-models
            auto_profile:
              capability: premium
              specialties: [plan, review]
              reasoning: preferred
```

### Target profile semantics

- `capability`: `economy`, `standard`, `high`, or `premium`. Map to ordinal indices 0–3.
  This is an administrator qualification, not a model-name inference.
- `specialties`: task-kind multi-select. Start with `plan`, `implement`, `debug`, `refactor`,
  `review`, `research`, `explain`, `operate`, `write`, and `chat`.
- `reasoning`: `normal` or `preferred`. This influences preference among suitable targets;
  it does not override actual model support or client generation parameters.
- Empty specialties mean general-purpose, not unsupported for every task.
- Require a capability profile for each enabled logical target in an auto group before
  activation. Disabled targets may be incomplete. Existing non-auto targets need no profile.
- Keep factual support for tools, images, context length, and API formats in existing model
  capability/catalog data. Editable qualifications cannot grant unsupported features.

For an alias-reference target, the outer profile qualifies that logical target locally.
Require administrators to qualify the child alias conservatively for all leaves that it may
dispatch or fail over to. A profile must not pretend an alias is premium when its fallback can
silently run an economy model. Validate what can be established from configured profiles and
warn about visible heterogeneous descendants and child fallback groups. The outer profile is
the administrator's attestation for the whole logical target. Ordinary child aliases need no
new leaf profiles; absence of those profiles is not a validation error. Explain that Plexus
cannot independently verify the administrator's capability claim.

### Alias and group semantics

- Thresholds are alias-scoped and shared by that alias's auto groups.
- Preserve existing group priority. Auto reorders targets within its group, not across groups.
- Classify once and reuse that judgment across the alias's auto groups.
- Preserve ordinary group behavior in mixed-policy aliases, while applying hard continuation
  safety to the entire request. Warn that non-auto fallback groups are not quality-qualified
  by auto; never present them as guaranteed to meet the inferred capability requirement.
- An auto group with eligible targets but no suitable target selects its first eligible logical
  target in configured order, preserving child-policy leaf order for alias references. Record
  `no_suitable_target_first_option` and disclose the unmet capability requirement. Keep remaining
  eligible targets in configured order for failover. A group with no eligible targets contributes
  no candidates; continue to later groups. If the entire alias has no eligible candidates, retain
  existing no-route/access/quota errors.
  Configured ordinary fallback groups are an explicit administrator acceptance of baseline
  quality risk; mark that outcome `unqualified_group_fallback`. Do not create such groups implicitly.
- Do not allow an unconditional sticky hoist to cross the auto policy's suitability rules.
- Resolve alias-reference leaves using the child alias's own ordinary policy, preserving the
  resulting leaf order within the selected logical target. Preserve outer alias metadata for
  dispatch as existing expansion does.
- Initially reject nested auto aliases during activation. Supporting references to ordinary
  aliases is required; repeated or conflicting adaptive judgments are not required for v1.
- Keep existing cycle validation. Do not silently discard target profile provenance when
  deduplicating leaves reachable by different target paths. After logical-target ordering, the
  first eligible path wins and its profile/provenance is recorded. Later paths never bypass
  an earlier suitability exclusion merely because they share a leaf.
- Direct provider/model requests remain unchanged. For explicit direct-group requests, retain
  the explicit group boundary; whether auto runs inside that group must be specified and tested.
  Proposed behavior: it runs within the selected group, never expands to other groups.

### Validation and compatibility

- Validate finite numeric values, nonnegative weights, and weights summing to one.
- Bound scores and confidence to their rubric ranges. Tier boundaries must be strictly ordered
  inside 0–3; equality advances to the higher tier.
- Require nonnegative switching margins; savings fraction is in 0–1.
- Validate task minimum tiers and specialties against the same task-kind vocabulary.
- Validate a classifier alias capable of Decisions execution, with no reachable auto group.
- Validate baseline policy as an existing deterministic policy; initially support `in_order`
  and `cost`. Unknown pricing cannot be treated as free in auto's baseline cost comparison.
- Restrict auto to supported text routes. Preserve old configuration defaults unchanged.
- Modes are `off` and `active`. Structurally valid incomplete profiles may be saved
  in off mode. Active requires complete enabled-target profiles and a usable classifier.
  Invalid numeric values or malformed fields cannot be saved in any mode.
- `rubric_version` selects a server-shipped rubric, not arbitrary client instructions. Reject
  unknown versions; show supported versions read-only or as a constrained selector in the UI.
- Switching away from auto in the UI should preserve its settings unless explicitly cleared.
- Changes to profile or policy configuration invalidate cached decisions that depend on them.
  Scoring changes do not require reclassification when the judgment rubric is unchanged.

## Request execution

```text
Incoming alias request
  → resolve configured target graph with group/target provenance
  → health/API/access/quota filtering
  → detect hard continuation requirements
  → obtain one judgment: continuation reuse, exact cache, or Decisions call
  → compute demand and minimum tier
  → rank suitable logical targets within each auto group
  → apply conditional incumbent preference and cache economics
  → produce candidate list and decision record
  → existing target admission / transformation / dispatch / failover
  → update observations from actual target and reported usage
```

Refactor candidate resolution only as far as needed to preserve provenance and defer auto
ordering until eligibility is known. Keep one normal router with a request-aware policy
contract, not a second global routing service. Ordinary selectors should retain their current
behavior and avoid classifier initialization or overhead.

The policy accepts a request context, eligible candidate tree, alias configuration, and scoped
observations. It returns ordered candidates and structured decision metadata, identifying any
explicit first-option capability fallback. It
cannot add providers, alter the requested alias, or bypass access, quotas, API compatibility,
or admission. Recheck volatile health/admission constraints at dispatch as today.

In active mode, classification and policy evaluation run before dispatch within the total
classifier deadline. Off mode uses declared baseline ordering without classification. Use
explicit management previews and offline evaluations to test policy behavior.

## Classification contract and lifecycle

Use four typed questions in one Decisions request:

| Question | Type | Interpretation |
| --- | --- | --- |
| `task_kind` | Choice | Closest task kind, including an explicit unknown outcome |
| `complexity` | Score | 0–3 rubric for scope, dependencies, ambiguity, and stakes |
| `capability_required` | Score | 0–3 rubric for capability needed, ignoring price |
| `deep_reasoning` | Noul | Likelihood that extended reasoning materially helps |

Use four explicit score criteria mapped to 0–3, allowing fractional scores if the provider
returns them. Normalize noul into 0–1 only according to verified provider semantics; never
guess a conversion from an undocumented scale.

Provide bounded context: latest substantive request, relevant recent conversation, necessary
tool activity summaries, and structural hints. Do not send the entire history automatically.
Treat all request/tool text as untrusted evidence. Rubric instructions come from server-owned
configuration. Exclude prices, budget pressure, candidate model names, and cache observations.

The adaptive consumer must validate question IDs, answer types, allowed labels, finite scores,
rubric ranges, and optional confidence/probability ranges. Do not silently substitute a valid
looking judgment for malformed output. Confidence is uncalibrated; the threshold is a policy
caution trigger, not a probability guarantee. If confidence is present on any required choice
or score answer and falls below the threshold, use uncertainty handling. Missing optional
confidence is neutral and recorded as unavailable; it does not disable routing. Noul has no
separate confidence field. Unknown task outcomes still use uncertainty handling.

### Classification avoidance and caching

1. Detect outstanding tool/native-state continuations before classification.
2. Reuse a valid previous judgment for acknowledgements and clear continuations.
3. Check an exact judgment cache before contacting the classifier.
4. Classify substantive new requests or changed task context.

Short length alone must never imply low capability. A short first request is still classified.
Tool-result-only requests must not be labeled from the tool output alone.

Use bounded in-memory caches with TTLs and single-flight deduplication. Judgment cache keys
include authenticated API-key identity, classification-context fingerprint, rubric version, classifier
identity/version, and structural hints. Keep judgments separate from policy evaluations so
weight, budget, and price changes can reuse the semantic result. Expire judgments on model
alias/catalog changes when the resolved classifier version is not stable.

Do not persist raw classification inputs solely for caching or explanation. Hashes are also
sensitive metadata; scope access and retention accordingly.

### Internal Decisions execution

- Reuse internal classifier dispatch, not an HTTP call to the same Plexus instance.
- Use an explicitly administrator-authorized non-auto Decisions model alias and a server-owned
  internal-purpose marker. This permits internal classification for the configured auto alias;
  it does not grant the caller direct access to the Decisions alias.
- Give the child request its own trace, linked to the parent. Never overwrite parent debug data.
- Apply parent cancellation and one total deadline across retries/backoff. The example's
  initial total budget is provisionally 500 ms; revise it from observed p50/p95/p99 latency.
- Default to one attempt on the hot path. Any fallback classifier attempt shares the deadline.
- Add a circuit breaker and bounded concurrency for classifier outages or overload.
- Account for classifier usage/cost, including preview calls and calls whose result arrives too
  late to influence dispatch. Unknown classifier cost remains unknown, not zero.
- Classification failure restores baseline authorized routing; it cannot bypass hard
  continuation, permission, or quota constraints.
- Document administrator authorization, classification data sharing, and linked caller accounting.
  Do not send context to a classifier alias that the administrator has not authorized.

## Scoring and suitability

For validated complexity `C`, required capability `K`, and reasoning likelihood `R`:

```text
raw_demand = clamp(complexity_weight × C + capability_weight × K
                   + (R >= reasoning_threshold ? reasoning_boost : 0), 0, 3)
scored_tier = tier selected by the configured boundaries
required_tier = max(scored_tier, configured task minimum tier)
```

Normal selection requires profile capability to meet `required_tier`. Cache savings and
specialties cannot undo this check. The explicit first-option fallback applies only when
no eligible target meets the requirement. Keep the formula pure and
versioned so preview and production use exactly the same implementation.

For each suitable logical target, compute a preference score on a 0–1 scale:

```text
preference = clamp(1 - (target_tier - required_tier) / 3
                   + (task specialty matches ? specialty_bonus : 0)
                   + (deep reasoning and reasoning preferred ? reasoning_bonus : 0), 0, 1)
```

This prefers sufficient capability without always paying for excess. Bonuses cannot make an
unsuitable target eligible. The comparable band consists of targets within `preference_margin`
of the highest preference score. Prices are estimated per expanded leaf; a logical target's
first eligible leaf, as ordered by its ordinary child policy, represents its initial cost and
warmth. Keep its fallback leaf order; do not choose a cheaper internal leaf against child policy.

With no incumbent, select the cheapest reliably priced initial leaf in the comparable band.
If any band's cost is unknown or cost ranges overlap, use descending preference then declaration
order instead of assuming missing prices are free. Order remaining comparable logical targets
by the same rule, followed by other suitable targets in preference/declaration order.

With an incumbent, first enforce continuation safety and capability suitability. Otherwise
hold it if comparable unless economic margins justify a switch. A preference improvement
greater than `preference_margin` may switch without savings, traced as `specialist_switch` or
`preference_switch`. Use declaration order as the final deterministic tie-break.

Unknown/low-confidence judgments retain an eligible incumbent meeting
`uncertainty_minimum_tier`, or apply baseline ordering only to auto targets meeting that floor.
No qualifying auto target means select the first eligible option under the explicit fallback rule.
This floor makes uncertainty fallback a declared conservative policy rather than evidence
that an economy model is adequate. The first-option exception must disclose unmet qualification.
Off mode uses ordinary admin-selected baseline behavior.

A valid judgment with no suitable auto target does not become a malformed judgment. Select
the first eligible configured option and record the unmet requirement. Existing eligibility
and continuation constraints remain authoritative even for this fallback.

Score hysteresis prevents borderline downward changes after a previous higher requirement.
It must not lower the current request's required tier. Upgrade immediately when the incumbent
cannot satisfy the current requirement. Delay marginal downgrades until the score clears the
configured deadband and economics justify switching.

`score_deadband` is measured in the 0–3 demand scale. Store the previous accepted demand and
required tier with the incumbent. A downgrade clears when current demand is below the boundary
for the previous tier minus the deadband and no task floor requires that tier. Never apply this
test ahead of a hard continuation lock.

Do not introduce daily/monthly soft budget downgrades that violate suitability. Existing
quotas may eliminate targets; choose another suitable target, or the first remaining eligible
option if none is suitable. Never reintroduce a quota-blocked target.

## Cache-economic switching

### State and identity

Keep these separate:

- Incumbent: actual provider/model used by the last successful relevant dispatch.
- Affinity: preference for an upstream account/backend given a stable session/prefix.
- Warmth: time-bounded evidence of reusable prefix cache for that target.
- Continuation lock: a requirement to retain provider/model for protocol correctness.
- Previous accepted demand/required tier and policy version: inputs for downgrade hysteresis.

Scope new state to authenticated API-key identity, alias, API contract, and conversation
branch. Client-provided session IDs are namespaced hints, never authentication or ownership.
Warmth observations additionally identify the upstream credential/account, actual model version,
and effective prefix. Do not use the current global sticky map as API-key-scoped auto state.
Use a server-owned key identifier, not the secret key value, in state keys and traces.

Start with process-local bounded state. Cold state after restart is acceptable and explicit.
Distributed cache coordination is not required for v1. Guard against concurrent branches and
late completions overwriting newer session state; record request/branch lineage and sequence.

### Cost model

Estimate the current request, not hypothetical future turns:

```text
E(cost) = uncached_input × uncached_rate
        + cache_read_input × cache_read_rate
        + cache_write_input × cache_write_rate
        + expected_output × output_rate
        + applicable_request_fees
```

Input categories must be disjoint. Normalize price units and whether cache-write pricing is
a total category rate or an incremental surcharge. Never add two full rates to the same tokens.
Support configured context-dependent price ranges and reasoning/output billing where known.
Unknown fees, prices, or output sizes must appear as uncertainty, not zero-cost assumptions.

Estimate effective prefixes after relevant target transformations, including system content,
tools, cache controls, and compaction. Avoid network-bearing preprocessing just to rank targets.
When the effective wire prefix cannot be predicted cheaply and safely, mark warmth uncertain.
For v1, use known stable prefix fingerprints and reported usage only where transformations
are understood. Defer exhaustive wire-prefix prediction; compaction or opaque rewrites invalidate
optimistic warmth rather than requiring speculative transformation work during ranking.

Use provider-reported cached/cache-creation tokens and observation age where available.
Account for minimum cacheable lengths and provider-specific TTLs. A previous successful request
does not prove cache warmth. An aggregator provider name may not identify the actual backend.
Do not assume switching erased another model's cache; retain per-target observations until expiry.

Output estimates use bounded historical task-class observations when available and conservative
fallback estimates otherwise. `max_tokens` is a ceiling, not predicted output. Evaluate plausible
ranges rather than claiming exact savings from a single fragile output prediction.

For suitable, comparable targets, switch economically only when:

```text
savings = E(incumbent_cost) - E(candidate_cost)
savings > minimum_savings_usd
and savings / E(incumbent_cost) > minimum_savings_fraction
and upper_bound(candidate_cost) < lower_bound(incumbent_cost)
```

Handle zero incumbent cost explicitly. Include target warm-up in its cost estimate; do not
subtract a second switch penalty afterward. Classifier cost belongs in total request accounting,
but once incurred it is sunk and excluded from the stay-versus-switch difference.
Derive uncertainty bounds from token/output estimate ranges and uncertain warmth. Record the
inputs and versioned estimator; no extra user-tuned uncertainty scalar is needed for v1.

### Switching outcomes

| Situation | Outcome |
| --- | --- |
| Incumbent fails current suitability, without continuation lock | Upgrade regardless of cache economics |
| Incumbent has expired/changed prefix | Do not credit assumed warm pricing |
| Comparable suitable target saves too little | Hold incumbent |
| Same-tier model swap | Apply the same cache/economic rules |
| Both targets have warm prefixes | Compare both warm estimates |
| Unknown price/warmth | No cache-driven override; use suitability and deterministic preference |
| Hard continuation lock | Keep locked target or fail safely |
| Incumbent blocked by access/quota/health | Remove it; never resurrect it for cache savings |
| No eligible target meets capability requirements | Select first eligible configured option and disclose unmet qualification |

Do not force client caching settings or choose longer provider TTLs as part of v1. Preserve
existing controls and explain what cache behavior was actually available.

## Continuations, retries, and streaming

- Detect outstanding tool calls, partial tool batches, signed reasoning content, and native
  provider state. Do not switch until portability has been established.
- Hard continuation safety wins over scoring and switching. Reuse the task's prior judgment
  during a locked continuation; do not classify a tool result as a new task or attempt an upgrade.
- A completed tool workflow does not permanently lock a conversation. Reassess at a safe
  substantive user-turn boundary.
- If the locked target is unavailable or forbidden, return a clear continuation error unless
  a tested portable replay path exists. Cost savings are not a reason to replay unsafe state.
- Produce one candidate ordering before attempts. Do not reclassify on provider failure.
- Preserve `failover.enabled` and existing retry conditions. Auto fallbacks remain suitable
  except for the explicitly recorded no-suitable-target first-option fallback list.
- Do not reroute a response after bytes have been emitted. Mid-stream errors remain dispatch errors.
- Update incumbent and warmth from the actual selected target, not the proposed first choice.
  Early streaming success may establish affinity, but only reported usage establishes cache facts.
- Responses requests, including those with `previous_response_id`, use the same auto policy
  as other supported text requests. Add no Responses-specific exclusion, forced baseline,
  lock, or replay path. Preserve existing Responses processing and ordinary request constraints.

## Persistence and API work

Recommended storage is additive nullable JSON policy/profile fields:

1. Alias-level `auto_routing` JSON on `model_aliases`.
2. Target-level `auto_profile` JSON on `model_alias_targets`.

Apply equivalent changes to SQLite and Postgres schemas. Do not repurpose the unrelated
`generation` column or hide target qualifications in a second copy of group definitions.
Existing rows remain null and keep existing behavior.

Update repository row types, transactional save, reconstruction, configuration import/export,
cache rebuilds, and PUT/PATCH serialization. Test defaults and normalization so settings cannot
disappear during legacy target normalization or when saving an unrelated alias field.

Before schema implementation, read and follow the
[db-schema-migrations skill](../../.agents/skills/db-schema-migrations/SKILL.md). Generate artifacts
through the required workflow; never create or edit migration artifacts manually. This planning
change creates no schema changes or migration artifacts.

Document new fields in alias OpenAPI schemas and add an authenticated management preview API.
The current model test endpoint probes a provider/model; the metadata resolve endpoint describes
catalog metadata. Neither is already an auto-routing simulation.

The preview API must accept an unsaved validated alias draft, bounded sample context, and an
explicit simulation scenario. It must never dispatch a generation request or mutate incumbent,
warmth, or production budgets as if inference had happened. Classifier calls still cost money
and must be accounted for as previews.

## Models UI

Read [frontend rules](../../packages/frontend/AGENTS.md) before implementation. Extend the
existing Models editor rather than creating a separate router administration screen.

### Per-target controls

When the group policy is Auto, show:

- Capability tier selector with clear qualification descriptions.
- Specialty multi-select using the shared task vocabulary.
- Reasoning suitability selector.
- Warnings for incomplete profiles, unsuitable descendants, and unsupported factual features.

Provide the same controls for concrete targets and alias references. Keep metadata attached
to the target when reordering; changing the provider/model should require reviewing its profile,
not silently carrying a qualification to an unrelated model. Preserve existing enable/delete
and drag/reorder behavior.

### Alias-level controls

Show an Auto routing panel when any group uses Auto:

- Off/active mode and classifier alias selection, restricted to administrator-authorized usable
  Decisions model aliases.
- Classification deadline and deterministic baseline policy.
- Complexity and capability weights, with their sum shown and validated.
- Deep-reasoning threshold and boost.
- Confidence threshold.
- Uncertainty minimum capability tier.
- Ordered tier boundaries, with a visual 0–3 score scale.
- Task-specific minimum tier overrides.
- Switching deadband, absolute/percentage savings margins, specialty/reasoning preference
  strength, and preference-switch margin.

Group advanced classifier/cache controls separately from common scoring controls. Explain that
minimum capability governs normal selection and switching margins do not block required upgrades.
Explain that no-suitable-target fallback chooses the first eligible option with unmet qualification. Provide
Reset defaults and inline errors. Do not save invalid drafts or silently reorder bad thresholds.
Allow structurally valid incomplete profiles to be saved in off mode, with activation blockers
listed explicitly. Disabled targets may remain incomplete.

Do not require administrators to duplicate baseline ordering in a second target list. For an
`in_order` baseline, use the existing declared target order; for `cost`, use eligible qualified
targets and a documented unknown-price fallback.

### Test routing preview

Allow sample request/context entry and simulation choices:

- Cold conversation.
- Existing incumbent, with context-size estimate and assumed cache state.
- Unknown cache state.

Label all simulated cache observations as assumptions. Show:

1. Typed judgment, confidence, classifier identity, latency, and classifier cost if known.
2. Composed demand, reasoning adjustment, task floor, and required tier.
3. Logical target ranking and expanded leaves with eligibility/suitability reasons.
4. Incumbent, estimated costs/ranges, and switching decision.
5. Baseline behavior for uncertainty or timeout.

Retain the judgment while adjusting weights, boundaries, and switching margins. Recompute
through the same pure policy used by production; do not call Jev again until sample context,
classifier, or rubric changes. Bind reusable judgment handles to the authenticated admin and
context/rubric. Do not trust client-supplied judgments as production routing authority.

Make classifier spending explicit before a preview run. Use accessible controls, keyboard
navigation, loading/cancellation states, and readable validation feedback. Never imply preview
results are measured provider cache hits or verified answer-quality guarantees.

## Observability

Record a versioned structured auto decision with:

- Parent/child request IDs, alias, group, policy/rubric versions, and configuration fingerprint.
- Judgment source: fresh, exact cache, continuation, or unavailable.
- Validated signals, confidence status, composed demand, and applied tier floors.
- Eligible logical targets/leaves and exclusion reasons.
- Incumbent and any continuation lock.
- Price sources, token estimates, warmth evidence age, uncertainty, and estimated savings.
- Proposed order, final dispatched target, retry outcomes, and actual usage/cost.
- Reason codes such as `quality_upgrade`, `economic_switch`, `cache_hold`, `specialist_switch`,
  `continuation_locked`, `classifier_timeout`, `invalid_judgment`, and
  `no_suitable_target_first_option`.

Use existing request traces/observability rather than introducing an unrelated audit system.
Avoid raw prompt retention merely to explain routing. Restrict traces by existing authenticated
access and define bounded retention for new state.

Track classification p50/p95/p99, added TTFT, cache reuse, classifier failures/cost, switch rate,
oscillation, baseline fallback frequency, predicted-versus-actual cost, and generation failures.
Request logs measure economics and operations, not answer quality. Quality needs a curated
evaluation set or explicitly collected feedback.

## Implementation sequence

### Phase 1: Freeze the contracts

- Confirm proposed config names, task vocabulary, target qualification semantics, and mixed
  group behavior.
- Apply API-key-scoped state and the administrator-authorized Decisions alias; document
  linked charging and data sharing.
- Verify Decisions score/noul/confidence semantics against enabled upstreams.
- Verify cache units, TTLs, minimum prefixes, and continuation constraints for initial providers.
- Build a representative evaluation fixture set, including ambiguous follow-ups.

Exit criteria: config and policy tables are unambiguous; unsupported cases have explicit behavior.

### Phase 2: Configuration and persistence

- Extend backend schemas, frontend types, API serializers, and selector labels.
- Add nullable alias policy and target profile storage using the required migration workflow.
- Update repository round-trips, validation, import/export, and management API documentation.
- Keep auto inactive until a complete policy and qualified target set exists.

Exit criteria: both dialects retain all settings across save/reload/restart; old aliases behave
unchanged; partial invalid saves cannot leave inconsistent rows.

### Phase 3: Pure policy and request-aware routing

- Implement validated judgment, score composition, suitability, preferences, and economics as
  independently testable functions.
- Preserve logical-target/group provenance during resolution and expansion.
- Integrate one-pass auto ordering after eligibility filtering and before dispatch attempts.
- Make sticky behavior conditional for auto without changing ordinary selectors.
- Add safe continuation handling, suitable fallback ordering, and the explicit first-option exception.

Exit criteria: deterministic replay, no forbidden candidate resurrection, and no classification
inside per-target ordering/retry loops.

### Phase 4: Classifier lifecycle and cache observations

- Add bounded internal Decisions execution, child traces/accounting, cancellation, and circuit breaker.
- Add exact judgment caching, continuation reuse, single-flight, and API-key-scoped state.
- Normalize price categories and feed actual cache usage into time-bounded observations.
- Verify policy behavior with previews and offline fixtures.

Exit criteria: outages preserve safe baseline behavior, classifier cost is visible, and cache
estimates distinguish evidence from assumptions.

### Phase 5: Editor and preview

- Add per-target qualifications and alias-level scoring/switching controls.
- Add authenticated preview with unsaved drafts, simulation scenarios, and reusable judgments.
- Complete round-trip UI tests and real-browser rendering/interaction verification.

Exit criteria: administrators can configure, test, save, reopen, and adjust auto without editing
configuration files; preview and inference produce identical policy results for equal inputs.

## Verification plan

Before writing tests, read [TESTING.md](../TESTING.md) and the
[vitest skill](../../.agents/skills/vitest/SKILL.md). Use project test placement, mocks, registered
spies, and singleton resets. Add regression tests that demonstrate each routing bug before fixing it.

### Unit tests

- Score boundaries, reasoning boost, floors, confidence/unknown handling, and invalid answer ranges.
- Profile suitability, specialty preferences, deterministic ties, and asymmetric downgrade deadband.
- Cache cost categories/units, context-price ranges, expiry, prefix changes, same-tier swaps,
  both-target warmth, zero costs, unknown prices, and uncertain output estimates.
- Economic margins never suppress required upgrades or bypass hard continuation affinity.
- Cache fingerprints, API-key separation, single-flight, cancellation, and late-result ordering.
- No-suitable-target fallback selects the first eligible configured option, not a filtered-out target.

### Integration and persistence tests

- Concrete and alias-reference profiles survive save/load/import/export on SQLite and Postgres.
- Alias-scoped thresholds survive unrelated edits, normalization, and config cache rebuilds.
- Auto groups retain priority and provenance; ordinary groups/aliases/direct routes stay unchanged.
- Alias cycles and nested auto references produce explicit validation outcomes. Ordinary child
  aliases need no leaf profiles; visible heterogeneity warns and outer attestations survive.
  Shared leaves follow first eligible path ordering with recorded provenance.
- Access, quotas, cooldowns, API support, and admission remain authoritative.
- One classification per request; none per fallback attempt; no classifier recursion.
- Timeout/invalid output/circuit-breaker behavior uses safe baseline order with linked accounting.
- Failover chooses suitable leaves or the explicit first-option exception list; actual winner
  updates state; disabled failover remains honored.
- Tool batches, signed reasoning, Responses continuations through the normal auto policy,
  streaming errors, and concurrent branches.
- Preview never dispatches generation or changes production routing state, and only authorized
  callers can access/reuse a judgment.

### UI and browser tests

- Auto can be selected; target controls work for concrete and alias-reference entries.
- Reordering, target replacement, switching policies, defaults, and validation preserve data.
- Save/reopen/restart retains exact settings.
- Preview cancellation/errors/simulation labels are clear; threshold edits reuse one judgment.
- Keyboard access and layout work at supported viewport sizes.

Follow the [frontend-testing skill](../../.agents/skills/frontend-testing/SKILL.md) for implementation
verification: boot the worktree-safe stack, auto-login, and verify the actual editor/preview in a
real browser. Frontend source changes must not be handed back unverified.

Run repository-root commands after implementation:

```bash
bun run test
bun run typecheck
bun run lint:check
bun run format:check
bun run lint:openapi
```

Use relevant focused tests during development, then the required project checks. Report failures,
skipped checks, and blocked provider/browser validation explicitly. This documentation-only plan
does not require application startup or unrelated application tests.

## Confirmed decisions

| Decision | Agreed behavior |
| --- | --- |
| Authenticated state scope | API-key identity, never a client session ID alone |
| Classifier authority | Explicit administrator-authorized Decisions model alias |
| Initial classifier deadline | Provisional 500 ms total budget; revise from observed latency |
| Mixed ordinary fallback groups | Preserve group behavior and visibly disclaim auto quality qualification outside auto groups |
| Alias-reference qualifications | Outer administrator attestation for all reachable leaves; warn where visible facts conflict, without requiring ordinary child profiles |
| Nested auto aliases | Reject in v1 rather than issue multiple/conflicting judgments |
| No suitable target | Select first eligible option in configured list order; disclose unmet capability qualification |
| Responses continuation | No special treatment; use the normal auto routing policy |
| Price/cache uncertainty | No economic override based on missing data; use suitability and deterministic preference |

## Reference material

- [Reference Jev router](https://github.com/da-vinci-noob/pi-jev-model-router): task judgment plus
  deterministic routing and cache-switch hysteresis. It does not cache classifier judgments.
- [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching):
  provider affinity and cache behavior behind an aggregator.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): exact
  prefix matching, routing keys, usage reporting, and model-specific rules.
- [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching):
  cache controls, read/write pricing, prefix structure, and TTLs.
- [RouteLLM](https://github.com/lm-sys/RouteLLM): later reference for learned routing and quality
  evaluation, not a required dependency for this implementation.

Provider documentation changes. Reverify enabled models' actual rules during implementation;
do not encode reference documentation snapshots as universal cache guarantees.
