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
 * extensible set of "shapes". Two currently apply regardless of which
 * client is connecting:
 *
 *   - `cc-collision-shape.ts`: a caller tool is renamed ONLY when its name
 *     collides with a real Claude Code tool name (see
 *     `cc-reference-tools.ts`) AND its shape (required parameters) differs
 *     from that CC tool's — i.e. it looks like the real tool by name but
 *     isn't actually compatible, which would otherwise mislead the model
 *     or collide outright as a duplicate name. A same-name/same-shape tool
 *     (the caller genuinely has that CC tool) is left alone.
 *   - `mcp-shape.ts`: clusters MCP-server tools by shared name prefix into
 *     the `mcp__<server>__<tool>` convention real Claude Code uses.
 *
 * This is a deliberate departure from an earlier per-client design (a
 * hardcoded opencode-specific allowlist that proactively renamed opencode's
 * `bash`/`read`/`write`/... to their apparent CC equivalents): that
 * approach silently went stale whenever CC's own tool set changed (it did,
 * twice) and only ever helped one named client. Name-collision detection
 * against a live reference table generalizes to any client without a
 * per-client shape file, and only ever touches a tool that would otherwise
 * be ambiguous with a real CC tool.
 *
 * Adding support for a new detection strategy means adding a new shape file
 * and registering it in `registry.ts` — no changes to `pi-ai-executor.ts`
 * itself.
 */

/**
 * A single (wireName, renamedName) pair, with an optional description note
 * to append to the tool's description when the rename exists to disambiguate
 * a name collision with a real Claude Code tool (see `cc-collision-shape.ts`)
 * — e.g. `["Write", "mcp__Write", "ALWAYS USE THIS TOOL INSTEAD OF WRITE."]`.
 * Renames with no collision to disambiguate (e.g. MCP-server prefix
 * clustering) omit the third element.
 */
export type RenamePair = readonly [string, string, string?];

/**
 * One named tool's minimal wire description, sufficient for a shape to
 * decide whether it recognizes the tool and whether renaming it is
 * argument-safe. Only `name` is required; `parameters` is the tool's
 * `input_schema` (JSON Schema), which lets a shape compare
 * `parameters.required` against a reference tool's required parameters
 * before proposing a rename.
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
