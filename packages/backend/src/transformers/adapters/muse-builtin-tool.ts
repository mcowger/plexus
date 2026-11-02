/**
 * Muse Code's builtin tool declaration, required by Meta's Model API for
 * requests billed to a Muse Code subscription.
 *
 * Verified 2026-10-29 against `api.meta.ai/v1` with a subscription-minted key:
 *
 *   - A request with no `tools` at all succeeds (the gate only fires when the
 *     body declares tools), so nothing is injected when `tools` is empty.
 *   - A request whose `tools` are ordinary function declarations is rejected
 *     with HTTP 403 "This API key is billed to a Muse Code subscription, and
 *     this request does not carry Muse Code's builtin tool declarations."
 *     The same 403 covers `/v1/responses`, `/v1/chat/completions` and
 *     `/v1/messages`, so switching wire format is not an escape.
 *   - The check is per-subtool, not a whole-set hash: a `namespace` tool named
 *     `muse` whose entries exactly match real Muse Code builtin declarations
 *     satisfies it, and arbitrary extra top-level function tools are allowed
 *     alongside. Fabricated names, invented schemas, a single re-worded
 *     description, or an empty `tools: []` namespace all still fail (the last
 *     with a 400: `tools[1].tools` requires at least one item).
 *   - Client fingerprint headers are irrelevant: adding Muse Code's
 *     `user-agent`/`x-client-id` (what CLIProxyAPI and its forks do) changes
 *     nothing.
 *   - Which models are gated is not uniform across accounts; on the account
 *     probed here `muse-spark-1.3-contributor` was gated while
 *     `muse-wonder-1.0-contributor` still accepted arbitrary tools.
 *
 * ## Choosing the injected declaration
 *
 * Every exact declaration satisfies the gate equally, so the choice is not an
 * entitlement question — it is a cost/risk question. The criteria, in order of
 * weight:
 *
 *   1. Accidental selection. The model sees this tool and can call it; the
 *      client cannot execute `muse.*`, so one spurious call corrupts the turn.
 *      This dominates.
 *   2. Blast radius. What the capability does if anything ever does execute it.
 *   3. Token cost. 240 bytes is ~60 tokens, and even the largest plausible
 *      choice (~500 bytes) is ~125; this is a tiebreaker, not a driver.
 *
 * `cron_list` is injected because it is the smallest declaration in the set
 * (240 bytes), read-only, takes no arguments, and scheduling is essentially
 * never relevant to a coding turn — so spontaneous selection is rare and a
 * call would be harmless.
 *
 * Runners-up, and why they lost:
 *   - `subagent_status` (418 B, read-only, all args optional): just as
 *     harmless, but a no-required-args shape is trivially callable and only
 *     slightly less irrelevant. The natural fallback if zero-arg risk is the
 *     bigger concern.
 *   - `work_list` (525 B, read-only): "work" is central to agent loops, so a
 *     model is likelier to poke at it than at cron state.
 *   - `cron_delete` (314 B) and `work_stop` (339 B): both are id-gated, which
 *     is a real barrier to accidental calls, but both are destructive. Even
 *     though nothing executes `muse.*` today, injecting a deletion or stop
 *     primitive is a poor default.
 *
 * Deliberately avoided despite being small and equally gate-valid: `web_fetch`
 * (306 B), `web_search` (329 B), `read_skill` (334 B), `read_file` (1.1 KB) and
 * `bash` (4.7 KB). They match coding intent directly — `web_fetch` and
 * `web_search` especially are what a model reaches for unprompted — and the
 * ~100-byte saving is not worth a broken turn.
 *
 * Keep this choice constant across every route: the tools array participates in
 * prompt caching, so injecting different sets per model or provider fragments
 * the cache.
 *
 * ## If accidental selection becomes a problem
 *
 * Switching declarations does not fix this class of failure — every choice puts
 * *some* callable builtin in front of the model. The remedy is a synthetic
 * response: intercept a `muse.*` call in the response path (this adapter's
 * `postDispatch`, and a `postDispatchStreamChunk` for streams), answer it
 * gateway-side with a fixed result — `cron_list` is empty for every
 * Plexus-routed session — and continue the turn upstream, so the client never
 * sees an unexecutable call. That is deliberately not built yet: each
 * interception costs a second upstream request, and it only pays off once
 * accidental calls are actually observed in traces.
 *
 * Captured from Muse Code 1.4.14 (1.4.14-R7309.1, build
 * dec7d7497fecdad135ec5835a8161dbc92e55b58) via a logging reverse proxy
 * pointed at with `muse exec --base-url`. If Meta rotates the builtin schema,
 * re-capture the same way; a stale declaration is rejected exactly like a
 * fabricated one.
 */

/** Namespace Muse Code groups its builtin tools under. */
export const MUSE_BUILTIN_NAMESPACE = 'muse';

/** The `namespace` tool declaration injected into gated requests. */
export const MUSE_BUILTIN_NAMESPACE_DECLARATION = {
  type: 'namespace',
  name: MUSE_BUILTIN_NAMESPACE,
  description: 'Muse Code tool set.',
  tools: [
    {
      type: 'function',
      name: 'cron_list',
      description:
        'List all scheduled jobs for this session, with their cadence and next fire time.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      strict: false,
    },
  ],
} as const;

/** True when the body already carries a `muse` namespace (genuine Muse Code traffic). */
export function hasMuseBuiltinNamespace(tools: unknown[]): boolean {
  return tools.some(
    (tool) =>
      !!tool &&
      typeof tool === 'object' &&
      (tool as Record<string, unknown>).type === 'namespace' &&
      (tool as Record<string, unknown>).name === MUSE_BUILTIN_NAMESPACE
  );
}

/**
 * Appends the builtin declaration to a body that declares tools.
 *
 * Returns the payload by reference when there is nothing to do: no `tools`
 * array, an empty one (the gate does not fire), or a `muse` namespace already
 * present. The declaration is cloned so a caller mutating the payload cannot
 * corrupt the shared constant.
 */
export function injectMuseBuiltinTool(payload: Record<string, any>): Record<string, any> {
  const tools = payload.tools;
  if (!Array.isArray(tools) || tools.length === 0) return payload;
  if (hasMuseBuiltinNamespace(tools)) return payload;
  return {
    ...payload,
    tools: [...tools, structuredClone(MUSE_BUILTIN_NAMESPACE_DECLARATION)],
  };
}
