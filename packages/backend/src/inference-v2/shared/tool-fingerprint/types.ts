/**
 * Tool fingerprint shape registry — v2-native, independent of v1's
 * `filters/pi-ai-request-filters.ts` / `transformers/oauth/oauth-claude.ts`.
 *
 * Background: the v2 OAuth/Claude-masking path (`pi-ai-executor.ts`) forwards
 * requests through the vendored eliza `processBody()` pipeline
 * (vendor/eliza/plugins/plugin-anthropic-proxy) to mimic a genuine Claude
 * Code CLI session for OAuth billing purposes. That pipeline's `toolRenames`
 * dictionary (`ELIZA_TOOL_RENAMES` / `DEFAULT_TOOL_RENAMES`) was profiled
 * against elizaOS's own agent tool surface, not third-party clients like
 * opencode. Applying it to a non-eliza client's tools only renames the
 * handful of names that happen to coincide (e.g. `bash`, `glob`, `grep`),
 * leaving the rest of the client's tool surface (and any MCP-server tools
 * riding along in the same `tools[]` array) unrenamed and looking nothing
 * like a real Claude Code session — which is itself a strong non-CC signal
 * to Anthropic's abuse detection, independent of any single duplicate-name
 * collision.
 *
 * This module replaces `DEFAULT_TOOL_RENAMES` with a purpose-built,
 * extensible set of "shapes" — one per known client tool surface — each of
 * which recognizes its own tools by name (and, where relevant, schema) and
 * proposes safe rename pairs. "Safe" means: only rename to a real Claude
 * Code tool name when the argument schema is actually compatible enough
 * that passing arguments straight through won't break the tool (see
 * `opencode-shape.ts` for the worked example of what's excluded and why).
 *
 * Adding support for a new client (e.g. a different CLI agent) means adding
 * a new shape file and registering it in `registry.ts` — no changes to
 * `pi-ai-executor.ts` itself.
 */

/** A single (wireName, renamedName) pair. */
export type RenamePair = readonly [string, string];

/**
 * One named tool's minimal wire description, sufficient for a shape to
 * decide whether it recognizes the tool and whether renaming it is
 * argument-safe. Only `name` is required; `parameters` lets a shape check
 * required-parameter overlap before proposing a rename.
 */
export interface ToolDescriptor {
  name: string;
  parameters?: Record<string, unknown> | undefined;
}

/**
 * A recognizer for one client's tool surface (e.g. "opencode built-ins",
 * "generic MCP-server tools"). Shapes run in registry order; a tool name
 * "claimed" by an earlier shape is not offered to later shapes, so more
 * specific detectors should be registered first.
 */
export interface ToolShape {
  /** Stable identifier for logging/debugging. */
  readonly id: string;

  /**
   * Given the full list of tools on the outgoing request (already excluding
   * names claimed by earlier shapes), return the rename pairs this shape
   * recognizes. Must be a pure function of `tools` — no I/O, no randomness,
   * so the same pairs can be recomputed for reverse-mapping the response.
   */
  detect(tools: readonly ToolDescriptor[]): RenamePair[];
}
