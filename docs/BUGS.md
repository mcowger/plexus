# Known Bugs / Missing Instrumentation

All previously tracked bugs in this file have been resolved. See commit history for details.

---

## ~~inference-v2: missing `tokensPerSec` on streaming requests~~ — FIXED

**Fixed in:** `pi-ai-executor.ts` `buildUsageFromMessage`

`tokensPerSec` is now computed as `tokensOutput / (durationMs - ttftMs)` using the post-TTFT
window for streaming (mirrors the passthrough `streamingTimeMs` logic), or `tokensOutput /
durationMs` for non-streaming.

---

## ~~inference-v2: `ttftMs` null on non-streaming requests~~ — FIXED

**Fixed in:** `fetch-tap.ts` + `pi-ai-executor.ts`

The fetch tap now records a per-request TTFB timestamp (`ttfbMap`) — `Date.now()` before
`originalFetch()`, delta stored when the `Response` resolves (headers received = first byte
available). The executor reads this via `consumeTtfb(requestId)` after `complete()` returns
and passes it to `buildUsageFromMessage` as `ttftMs`.

---

## ~~inference-v2: debug log missing `responseHeaders`, `responseStatus`, and response snapshots~~ — FIXED

**Fixed in:** `fetch-tap.ts` + `pi-ai-executor.ts`

- `fetch-tap.ts` now calls `debug.addResponseMeta(requestId, response.status, responseHeaders)`
  immediately after the upstream fetch resolves, populating `responseStatus` and `responseHeaders`.
- `fetch-tap.ts` now calls `debug.addReconstructedRawResponse()` alongside `addRawResponse()` for
  both streaming and non-streaming branches.
- `pi-ai-executor.ts` now calls `debug.addTransformedResponseSnapshot()` alongside
  `addTransformedResponse()` in both the non-streaming and streaming `done` paths.

---

## ~~inference-v2: `kwhUsed` always null~~ — FIXED

**Fixed in:** `pi-ai-utils.ts` (`buildGpuParams`, `computeKwhUsed`) + `pi-ai-executor.ts`

`computeKwhUsed` resolves GPU params from the route's provider config (falling back to
`DEFAULT_GPU_PARAMS`) and model architecture from `route.modelArchitecture` (via
`resolveModelParams`), then calls `estimateKwhUsed`. Returns `null` only when no model
architecture is configured for the route. Called from `buildUsageFromMessage` for both
streaming and non-streaming success paths.

Note: provider-reported SSE energy comment lines (`: energy {"energy_kwh": ...}`) remain
unhandled — pi-ai's typed iterator never surfaces them. The estimate covers the gap for
routes with a configured model architecture.
