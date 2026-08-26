# Usage Analytics Range Correctness and Performance Plan

## Objective

Correct Issue #823 across Dashboard Usage Analytics and Detailed Usage without making the default dashboard slower or returning unbounded analytics payloads.

Success means:

- Hour, Day, Week, Month, and Custom use the complete requested time window.
- Custom dates are editable and are sent unchanged to the backend.
- KPI cards, time series, and categorical breakdowns no longer depend on 100- or 5,000-row client samples.
- Default dashboard requests do not compute grouped analytics unless the active view needs them.
- Initial loads show skeletons; later refreshes retain existing data with an accessible loading indicator.
- Series, grouped dimensions, custom ranges, cache entries, and serialized responses have explicit bounds.

## Confirmed Problems

1. `packages/frontend/src/components/dashboard/tabs/UsageTab.tsx` receives the Custom range callback but does not pass it to `TimeRangeSelector`. Selecting Custom can therefore issue a zero-duration request.
2. Dashboard model/provider/API-key charts aggregate only the newest 5,000 raw records in `packages/frontend/src/lib/api.ts`.
3. `packages/frontend/src/pages/DetailedUsage.tsx` derives KPI cards from at most 5,000 rows and categorical views from at most 100 rows.
4. Backend `summary.stats` intersects the requested range with a fixed seven-day window, making Week and Month statistics identical on staging.
5. Detailed Usage time-series metrics are incomplete: cost can be undercounted, while errors, duration, TTFT, and TPS are zero in the server-summary path.
6. Usage Analytics has no content loading state and can show empty charts while requests are still pending.
7. Global summary queries filter `request_usage.start_time`, but no standalone `start_time` index exists.

## Staging Baseline

Read-only `plexuscli` measurements showed:

- Preset summaries: approximately 0.94–1.03 seconds and 2–8 KiB.
- A 5,000-row projected breakdown response: approximately 1.35 MiB.
- A 100-row full usage response: approximately 188 KiB.
- Actual matching rows were approximately 2,800 for Day, 17,700 for Week, and 75,500 for Month.

These measurements establish that server-side aggregation should reduce transfer volume substantially, while query latency must be measured before adding indexes.

After implementation, a 20-request direct HTTP run against the dev proxy measured:

- Basic Day summary: 5,102 bytes, p95 6 ms.
- Basic Month summary: 10,588 bytes, p95 2 ms.
- Month summary with provider/model/API-key breakdowns: 21,712 bytes, p95 2 ms.
- Responses included both `MISS` and `HIT` cache headers; the larger maximum times
  were isolated cold/proxy requests, while repeated cached requests were 1–3 ms.

These measurements are endpoint-level results and are not substitutes for a
database benchmark on 100k- or 1m-row synthetic datasets.

The production-path checks now also enforce the 16 KiB basic-response and 128 KiB
grouped-response limits before a result enters the cache. Summary telemetry records
range, dialect, query duration, result cardinality, response bytes, and cache state.
Detailed Usage List mode requests only the displayed fields for its 100-row preview.

## Target API Contract

Extend `GET /v0/management/usage/summary` rather than adding another endpoint.

The default response remains `series`, `stats`, and `today`. Optional grouped dimensions are requested explicitly:

```text
?range=month&breakdowns=provider,modelAlias,apiKey&breakdownLimit=10
```

### Range semantics

- `hour`: rolling 1 hour.
- `day`: rolling 24 hours.
- `week`: rolling 7 days.
- `month`: rolling 30 days.
- `custom`: inclusive supplied boundaries, with a maximum duration of 12 months.
- `stats` and `series` use the same `[rangeStart, rangeEnd]` boundaries.
- Custom series retains adaptive resolution and never exceeds 100 buckets.

### Metrics

Return the following in `stats`, each series bucket, and each grouped entry where meaningful:

- Requests and errors.
- Input, output, reasoning, cached, and cache-write tokens.
- Total tokens using the quota formula: input + output + reasoning + cached + cache-write.
- Total cost.
- Average duration, TTFT, and tokens per second.
- Success rate.

### Group bounds

- Grouping is opt-in and absent from ordinary summary responses.
- Permit at most three dimensions per request.
- Default to the top 10 groups; clamp the requested limit to 50.
- Sort deterministically by request count, then name.
- Return an exact `Other` rollup plus `totalDimensions` and `truncated` metadata.
- Reject unsupported dimensions or excessive limits before executing queries.
- Keep basic responses under 16 KiB and grouped responses under approximately 128 KiB.

## Workstreams and Dependencies

### Workstream A: Backend aggregate contract

**Starts first and blocks frontend data integration.** Documentation and loading-state work can proceed independently.

1. Keep range parsing and bucket resolution centralized in `packages/backend/src/routes/management/usage.ts`.
2. Remove `statsStart`; make stats use the selected range exactly.
3. Add rich aggregates to the existing series and stats queries so the added fields do not require additional scans.
4. Parse and validate canonicalized `breakdowns` and `breakdownLimit` parameters.
5. Execute only requested grouped queries and apply `scopedKeyName(request)` to every aggregate.
6. Preserve page semantics for model aliases, direct traffic, probe traffic, statuses, and API-key display without exposing secrets.
7. Return top groups, exact `Other` values, and truncation metadata.
8. Keep SQLite queries sequential. Consider bounded Postgres concurrency only after measurement.

### Workstream B: Backend cache and performance instrumentation

**Can proceed in parallel with Workstream A after the final query parameters are named.** It blocks final performance acceptance, not frontend compilation.

1. Add a principal-scoped in-memory cache around completed summary responses.
2. Cache preset requests for 10 seconds and historical Custom requests for approximately 60 seconds.
3. Include role/key scope, range, dates, normalized dimensions, and limits in the cache key.
4. Coalesce simultaneous identical requests and never cache failures.
5. Record route duration, logical query duration, result cardinality, response bytes, cache hit/miss, dialect, and selected range.
6. Ensure the cache cannot share admin results with limited principals.

### Workstream C: API documentation and generated types

**Can proceed in parallel with backend implementation once the response shape is agreed.** Regeneration waits for source YAML completion.

1. Update `docs/openapi/paths/v0_management_usage_summary.yaml` with real preset durations, Custom limits, optional grouping, and validation responses.
2. Update `docs/openapi/components/schemas/UsageSummary.yaml` with range-scoped stats, rich metrics, grouped response types, and the quota token formula.
3. Update stale frontend comments describing stats as fixed seven-day data.
4. Regenerate `packages/backend/src/assets/openapi.json` and `scripts/openapi-types.ts`; do not edit generated artifacts manually.

### Workstream D: Dashboard Usage Analytics

**Custom wiring and loading UI can proceed independently. Aggregate integration depends on Workstream A.**

1. Pass `customDateRange` and `onCustomDateRangeChange` from `UsageTab` to `TimeRangeSelector`.
2. Replace three 5,000-row breakdown requests with one summary request containing model/provider/API-key breakdowns.
3. Keep provider/model concurrency on its existing endpoint.
4. Add request-generation or cancellation guards so older ranges cannot overwrite current state.
5. Show card-shaped skeletons on initial load.
6. During range refresh, retain existing charts and show an accessible loading status until replacements arrive.
7. Do not show an empty state until its request has settled successfully.

### Workstream E: Detailed Usage

**Loading UI can proceed independently. Aggregate integration depends on Workstream A.**

1. Populate KPI cards from `summary.stats`, not raw records.
2. Populate all time-chart metrics from rich `summary.series`.
3. Request only the active provider/model/API-key/status breakdown for categorical views.
4. Remove analytical reductions over the limited `records` array.
5. Fetch 100 raw rows only when List mode needs them; complete request browsing remains on Logs.
6. Retain the existing Refresh button spinner and add skeleton KPIs/chart content for initial load.
7. Preserve existing content with a small loading indicator on range/group refresh.
8. Guard polling and manual refreshes against stale responses.

### Workstream F: Limited-user Overall Dashboard

**Depends on Workstream A and can run in parallel with Workstreams D and E.**

1. Replace the two 5,000-row provider/model requests with optional summary breakdowns.
2. Keep identity and quota calls independent so slow analytics do not block primary account data.
3. Consume range-scoped stats directly instead of reconstructing totals from series.
4. Preserve existing progressive card rendering and cancellation behavior.

### Workstream G: Regression tests

**Backend fixtures can be prepared in parallel; assertions depend on Workstream A.** Load the `vitest` skill before editing tests.

Extend `packages/backend/src/routes/management/__tests__/usage-summary.test.ts` to cover:

- Every preset and valid Custom ranges.
- Missing, invalid, reversed, and over-12-month Custom ranges.
- Inclusive range boundaries and out-of-range exclusion.
- Range-scoped stats and all rich metric calculations.
- Quota-formula token totals.
- Each grouping dimension, top-N behavior, `Other`, and deterministic ordering.
- Admin versus limited-principal scoping.
- Cache-key separation and in-flight request coalescing.
- High-cardinality fixtures proving bucket/group/response bounds.

## Performance Gate and Optional Index

Benchmark SQLite and Postgres with representative 100k- and 1m-row datasets before changing schema.

Initial budgets:

- Basic cached summary p95 under 100 ms.
- Basic cold summary p95 under 750 ms.
- Bounded grouped summary p95 under 1 second.
- No measurable regression to request writes during dashboard polling.

If cold global summaries miss the budget, add `request_usage(start_time)` to both dialect schemas through the `db-schema-migrations` workflow. Edit only Drizzle schema files; never manually create migration files. Pre-aggregated tables, materialized views, and covering indexes are follow-up options, not part of this implementation.

## Integration Order

1. Finalize the response/query contract.
2. Implement Workstreams A, B, and C in parallel where dependencies permit.
3. Implement frontend loading-state portions of D and E independently.
4. After A stabilizes, integrate D, E, and F in parallel.
5. Complete G against the integrated contract.
6. Run the performance gate and add the optional index only if required.
7. Regenerate OpenAPI artifacts, run all checks, and perform browser verification.
8. After deployment, repeat read-only staging CLI latency, payload, and full-range total comparisons.

## Verification

Run:

```bash
bun run test
bun run typecheck
bun run lint:openapi
bun run format:check
bun run generate:openapi:asset
bun run sync:openapi:types
```

Load the `frontend-testing` skill, start `bun run dev:agent --detach`, and verify with a real browser:

- Initial skeletons and refresh indicators.
- Distinct Day, Week, and Month totals and breakdowns.
- Custom initialization, editing, validation, and exact request dates.
- Accurate Detailed Usage KPIs and every grouping mode.
- No stale data after rapid range/group changes.
- List mode remains a 100-row preview.
- Default Live Metrics dashboard never requests grouped analytics; Usage Analytics
  requests them because its active view needs the breakdown cards.
- Limited Overall Dashboard no longer transfers large raw breakdown datasets.

The dev-proxy verification passed these UI checks after the database was populated:
the Day summary showed 3,160 requests, Week 18,089, and Month 75,980; the Day
provider/model concurrency endpoints returned 81/94 points; and Custom loaded and
displayed editable dates with HTTP 200 summary/concurrency requests.

## Scope Boundaries

- No Detailed Usage list pagination or analytics export.
- No concurrency redesign.
- No schema change unless benchmarks fail.
- No blocking full-page spinner during ordinary refreshes.
- No pre-aggregated tables or materialized views in the initial solution.

## Critical Files

- `packages/backend/src/routes/management/usage.ts`
- `packages/backend/src/routes/management/__tests__/usage-summary.test.ts`
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/components/dashboard/tabs/UsageTab.tsx`
- `packages/frontend/src/pages/DetailedUsage.tsx`
