# Bun Client Disconnect Detection — Test Scripts & Findings

These scripts were written to characterize how (and whether) client disconnect events
propagate through Bun's `node:http` compatibility layer when Fastify streams a response.

Run any script with: `bun <script>.ts`

## Background

We needed to cancel upstream LLM fetch requests when a downstream HTTP client
disconnects mid-stream. This should be simple — but Bun's `node:http` layer has
multiple open bugs that make all the standard Node.js mechanisms unreliable for
streaming POST responses.

See the extensive block comment in `packages/backend/src/services/response-handler.ts`
for the full explanation of what was tried, what failed, and what works.

## Test Scripts

### `test-nodehttp.ts`
Tests every standard disconnect signal on a raw `node:http` server (no Fastify).
Confirms that `socket.close` and `req.close` DO fire on disconnect for GET requests
here — but this is **not** the same behaviour as POST requests through Fastify.

### `test-bunserve.ts`
Tests `Bun.serve()` (native Bun HTTP, not node:http). Confirms that `request.signal`
abort fires correctly and `ReadableStream.cancel()` is called on disconnect.
**This works**, but Fastify uses `node:http`, not `Bun.serve()`.

### `test-fastify.ts`
Tests disconnect signals through Fastify with a GET route. `socket.close` and
`request.raw.close` fire on disconnect here — but only for GET (no body to consume).

### `test-fastify-pipe.ts`
Tests the exact pipeline used in `response-handler.ts` (Readable.fromWeb → pipe →
PassThrough → reply.send) with a POST route. Shows `socket.close` fires and
`socket.destroyed` becomes `true` on disconnect **for POST requests too** — but only
when no auth middleware or body parsing delays are involved. In the real app with
Fastify's full middleware stack, this does not reliably fire in time.

### `test-fastify-post-pipe.ts`
Key finding: `request.raw.close` fires **immediately** (~2ms after request received)
for POST requests — when Fastify finishes consuming the request body — NOT when the
client disconnects. This means using `request.raw.once('close', ...)` for disconnect
detection in POST handlers is completely broken.

### `test-timing.ts`
Precise timing test confirming `request.raw.close` fires at ~+2ms (body consumed),
while actual client disconnect at ~+2000ms produces **no event at all**.

### `test-write-fail.ts`
Confirms that `res.write()` to a disconnected client never throws in Bun. Writes
silently succeed and no EPIPE/ECONNRESET errors are emitted, even 5+ seconds after
the client disconnects. (Bun issue #25919)

### `test-write-direct.ts`
Similar to above but writing directly to `reply.raw` (ServerResponse) rather than
through a pipeline. Same result: no errors, `socket.destroyed` stays `false`.

### `test-spy-all.ts`
Snapshots all enumerable properties on `req`, `res`, `socket`, and
`socket._writableState` every 100ms and logs changes. After client disconnect:
**nothing changes**. Zero properties update on any of these objects.

### `test-sym-handle.ts`
**The breakthrough.** Uses `Object.getOwnPropertySymbols(socket)` to find the
internal `Symbol(handle)` property, which holds Bun's underlying TCP socket handle.
This handle has a `.closed` property that transitions `false → true` correctly when
the client disconnects, even though all the Node.js-layer signals are broken.

### `test-cancel-chain.ts` / `test-cancel-chain2.ts`
Tests the cancellation propagation chain through `Readable.fromWeb()`:

- `pipeline.destroy()` (downstream end) → does **NOT** cancel the upstream Web
  ReadableStream. The fetch keeps running. ❌
- `nodeStream.destroy()` (source Readable.fromWeb node stream) → **DOES** call
  `cancel()` on the upstream Web ReadableStream, stopping the fetch. ✅
- `abortController.abort()` → also works to cancel an in-flight fetch. ✅

### `test-bun-internals.ts`
Quick introspection of the Socket object to list all symbols and prototype methods.
Used to discover `Symbol(handle)` and the `bunHandle.closed` property.

## Summary of What Works vs What Doesn't (Bun 1.3.14, node:http, POST requests)

| Mechanism | Works? | Notes |
|---|---|---|
| `request.raw.once('close', ...)` | ❌ | Fires on body consumption, not disconnect |
| `socket.once('close', ...)` | ❌ | Never fires for POST disconnect |
| `socket.destroyed` poll | ❌ | Stays `false` forever |
| `reply.raw.destroyed` | ❌ | Property is `undefined` |
| `res.write()` EPIPE | ❌ | Silently swallowed by Bun |
| `bunHandle.closed` poll | ✅ | Bun internal TCP handle — updates correctly |
| `abortController.abort()` | ✅ | Works if something triggers it |
| `nodeStream.destroy()` | ✅ | Propagates cancel() to upstream fetch |
| `Bun.serve() request.signal` | ✅ | But requires native Bun HTTP, not Fastify |

### `test-timeout-abort-signal.ts`
Confirms that `abortController.abort()` alone does **not** stop an already-in-progress
`Readable.fromWeb()` read loop. The same root cause as the client-disconnect bug —
the abort signal is consumed by `fetch()` at call time; aborting it afterwards has no
effect on the streaming body. The upstream fetch keeps running indefinitely. ❌

### `test-timeout-nodestream-destroy.ts`
Confirms that `abort()` + `nodeStream.destroy()` together do cancel the upstream
correctly, stopping the fetch within one tick of the interval. ✅

### `test-timeout-signal-listener.ts`
**The correct pattern for timeout support.** Adding `signal.addEventListener('abort',
() => nodeStream.destroy())` means any abort reason — client disconnect, timeout,
or anything else — flows through the correct cancellation path automatically. This
is what `response-handler.ts` now does, so that future timeout wiring at the route
level (e.g. `AbortSignal.any([signal, AbortSignal.timeout(ms)])`) requires no
further changes to the streaming handler. ✅

## Relevant Bun Issues

- https://github.com/oven-sh/bun/issues/14697 — ServerResponse doesn't emit close event
- https://github.com/oven-sh/bun/issues/25919 — Upstream fetch not cancelled when client disconnects (streaming proxy)
- https://github.com/oven-sh/bun/issues/7716 — IncomingRequest close event not emitted (marked closed but still broken for POST)
