/**
 * De-duplicates the `tools[]` array as a defensive safety net after
 * `cc-tools.ts`'s `stripDescriptionsAndInjectSyntheticTools()` has run with
 * our own computed `toolRenames` (see `registry.ts`).
 *
 * That injector unconditionally *prepends* a fixed set of synthetic Claude
 * Code tool stubs (Glob, Grep, Agent, NotebookEdit, TodoRead) to make the
 * tool set fingerprint like a real Claude Code session — required for
 * OAuth masking; Anthropic flags tool sets that don't resemble this list as
 * non-Claude-Code traffic. The injector has no awareness of the caller's
 * actual tools, so if a computed rename happens to target one of those 5
 * reserved names, the result is two tools with the same name — which
 * Anthropic rejects with `400 tools: Tool names must be unique.`
 *
 * The registry's shapes are designed to avoid this (each shape only
 * proposes a rename when schema-compatible with the target name), so in
 * practice this should be a no-op; it's kept as a defensive backstop in
 * case a future shape's rename target collides unexpectedly. The synthetic
 * stubs are always inserted before the client's real tools, so keeping the
 * LAST occurrence of each name preserves the client's richer tool
 * definition and drops only the redundant synthetic stub.
 *
 * @param body - Parsed JSON request body (already tool-renamed and
 *   synthetic-tool-injected)
 * @returns Body with `tools[]` de-duplicated by name (same reference if no
 *   duplicates were found)
 */
export function dedupeSyntheticToolCollisions(body: any): any {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) {
    return body;
  }

  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const tool of body.tools) {
    const name = tool?.name;
    if (typeof name === 'string') {
      if (seen.has(name)) {
        hasDuplicate = true;
        break;
      }
      seen.add(name);
    }
  }

  if (!hasDuplicate) {
    return body;
  }

  const lastIndexByName = new Map<string, number>();
  body.tools.forEach((tool: any, index: number) => {
    if (typeof tool?.name === 'string') {
      lastIndexByName.set(tool.name, index);
    }
  });

  const dedupedTools = body.tools.filter((tool: any, index: number) => {
    if (typeof tool?.name !== 'string') return true;
    return lastIndexByName.get(tool.name) === index;
  });

  return { ...body, tools: dedupedTools };
}
