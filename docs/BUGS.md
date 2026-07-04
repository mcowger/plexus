# Known Bugs / Missing Instrumentation

---

## inference-v2: `thinkingSignature` placeholder leaking as a signature — MITIGATED, partially verified

**Symptom:** Anthropic (native `cc`) rejects a request with:

```
400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid `signature` in `thinking` block"}}
```

This shows up intermittently, correlated with `WORK`-group failover away from and back to a
native Anthropic target (e.g. `cc` → `openrouter-s` → `cc`) on aliases with extended thinking
enabled.

**Root cause:** third-party bug in `@earendil-works/pi-ai`'s OpenAI-completions stream parser
(`openai-completions.js`), used for OpenRouter/Bedrock-style upstreams. `ensureThinkingBlock()`
stamps a new thinking block's `thinkingSignature` with the *JSON field name* it matched on the
delta (`reasoning` | `reasoning_content` | `reasoning_text`) before any real signature has
arrived. Later, `isEncryptedReasoningDetail()` only recognizes Gemini-style
`reasoning_details` entries (`{type: "reasoning.encrypted", id, data}`) to correlate a real
signature back onto the block. Bedrock-via-OpenRouter instead sends
`{type: "reasoning.text", signature: "..."}` — a shape `isEncryptedReasoningDetail()` doesn't
recognize — so the real signature is silently dropped and the leftover field-name placeholder
(literally the string `"reasoning"` in observed traces) is all that remains on
`thinkingSignature`. Confirmed live on staging: the raw upstream response's terminal
`reasoning_details` chunk did contain a real base64 Anthropic-format signature, but Plexus/pi-ai
never picked it up.

Forwarding that placeholder string to a client as if it were a genuine signature is worse than
omitting it: if a later turn is dispatched to native Anthropic (which validates signatures
cryptographically), the literal placeholder is rejected outright — this is the `400` above. It
could also coincidentally look like a signature from a completely different provider.

**Fix (chosen over patching pi-ai):** added `isPlaceholderThinkingSignature()` in
`packages/backend/src/inference-v2/shared/pi-ai-utils.ts`, recognizing the three known
placeholder strings. Applied as a guard at every point Plexus's own serializers read
`thinkingSignature` for output, so the placeholder is omitted/suppressed instead of forwarded:

- `context-to-anthropic.ts`: non-streaming (`messageToAnthropicResponse`) and streaming
  (`closeCurrentBlock()` inside `eventToAnthropicSSE`) — no `signature`/`signature_delta` is
  emitted when the value is a placeholder.
- `context-to-gemini.ts`: non-streaming `buildParts()`'s thinking branch — no `thoughtSignature`
  is set when the value is a placeholder. (Gemini's streaming thinking-delta path never emitted
  a signature in the first place, so no change was needed there.)

Shipped in PR [#660](https://github.com/mcowger/plexus/pull/660) (commit `a16ec078`).

**Verification performed on staging (2026-07-04), and what it actually proved:**

Reproduced by forcing `claude-opus-4-8`'s `WORK` group through `cc` → `openrouter-s` → `cc` via
target `enabled` toggles, with `sticky_session` disabled and debug tracing scoped to
`["cc","openrouter-s"]`.

- Confirmed the guard works at the point of leakage: a turn served by `openrouter-s` whose raw
  upstream response carried a real signature in the unrecognized `reasoning.text` shape produced
  **zero** `signature_delta` events in Plexus's transformed SSE output (previously this would
  have emitted `signature_delta` with the literal placeholder string). This is a direct,
  confirmed fix of the leak.
- Could **not** fully reproduce the original end-to-end 400, because doing so requires a thinking
  block with a placeholder/empty signature to be replayed to native Anthropic while still
  attached to an *active tool-use loop* (Anthropic requires the thinking block immediately
  preceding `tool_use` in the last assistant turn when continuing that loop). In every attempt,
  by the time a target-switch to `cc` happened, the client had either already resolved the tool
  loop (`stop_reason: end_turn`) — at which point clients drop thinking blocks from history
  entirely — or the `openrouter-s` response happened not to include a thinking block at all.
  Because of this, we only verified "no placeholder leaks out"; we did not directly observe
  Anthropic's behavior when handed back a thinking block with `signature: ""` (Plexus's
  `content_block_start` hardcodes `signature: ""` initially, and since the guard suppresses the
  `signature_delta` update, `""` is what a client ends up storing) while still inside an active
  tool loop.

**What to look for if this resurfaces:**

- Pull the debug trace (`GET /v0/management/debug/logs/{requestId}`) for the failing request and
  its immediately preceding turn (same conversation/`previousResponseId` or sticky-session key).
- In the *prior* turn's `transformedResponse`, check for a `thinking` content block. If its
  `signature` is empty (`""`) or one of the literal strings `reasoning` / `reasoning_content` /
  `reasoning_text`, and that turn was served by a non-native (OpenAI-completions-style) provider
  (e.g. `openrouter-s`, Bedrock-via-OpenRouter, etc.), this is the same bug family.
  - `""` should now be impossible to leak as a `signature_delta` post-fix, but the *initial*
    `content_block_start` still hardcodes `signature: ""` in `context-to-anthropic.ts`
    (`openBlock()`) — deliberately left alone as out of scope for this fix. If Anthropic turns
    out to reject a replayed empty-string signature under an active tool loop, the next fix is
    likely either (a) omitting the `signature` key entirely from `content_block_start` until a
    real value is known, or (b) upstream-patching pi-ai's `isEncryptedReasoningDetail()` to also
    recognize the `{type: "reasoning.text", signature}` shape so the real signature is captured
    instead of never being available at all.
- Check the *failing* turn's `rawRequest` (outgoing) for the replayed `thinking` block's
  `signature` value to see exactly what was sent to Anthropic.
- To reproduce deliberately: force a tool-call turn onto a non-native provider (`openrouter-s`),
  and — while the tool-use loop is still open (i.e. immediately after the model's `tool_use`
  response, before the tool result round-trip completes) — flip that target's `enabled` off and
  the native `cc` target's `enabled` on, then let the client send the tool result. This routes
  the tool-result continuation (which must carry the immediately-preceding thinking block) to
  `cc`. This is finicky to time by hand; whether a given response includes a thinking block at
  all (`thinking_tokens > 0`) is not fully controllable from the client side.

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
