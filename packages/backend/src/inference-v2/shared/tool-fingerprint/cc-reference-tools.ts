/**
 * Canonical reference of the CURRENT real Claude Code tool surface, used to
 * detect name collisions between a caller's own tool and a genuine CC tool
 * that happens to share its name but not its shape.
 *
 * Replaces the old approach of proactively renaming known third-party
 * client tools (e.g. opencode's `bash`/`read`/`write`) to their apparent
 * Claude Code equivalents by a hardcoded per-client allowlist
 * (`opencode-shape.ts`, removed). That approach silently went stale twice:
 * once when real CC dropped Glob/Grep/TodoRead, and would go stale again
 * the moment CC's tool set changes further (as it just did — Skill,
 * AskUserQuestion, and the Task-/Cron-/Workflow family of tools are current
 * CC tools that didn't exist in the older captures this pipeline was built
 * against).
 *
 * The new rule (see `cc-collision-shape.ts`): only rename a tool when its
 * NAME collides with one of the entries below AND its required top-level
 * parameters differ from that entry's — i.e. it looks like the real CC
 * tool by name but isn't actually shape-compatible with it, which would
 * otherwise mislead the model about how to call it or collide outright as
 * a duplicate name. A same-name, same-shape tool is left alone (it already
 * behaves like the real thing). A tool whose name doesn't match anything
 * below is left alone regardless of client (opencode, MCP, or otherwise) —
 * there's no CC tool it could be confused with.
 *
 * SOURCE: a genuine on-the-wire Claude Code request capture (rawrequest.json,
 * cc_version=2.1.200.048) — the full `tools[]` array and each tool's
 * `input_schema.required`.
 * TO UPDATE: capture a real Claude Code session's request body and diff its
 * `tools[].name` / `tools[].input_schema.required` against this table.
 */

/** Real CC tool name -> its required top-level input parameters (order-independent). */
export const CC_TOOL_REFERENCE: Readonly<Record<string, readonly string[]>> = {
  Agent: ['description', 'prompt'],
  AskUserQuestion: ['questions'],
  Bash: ['command'],
  CronCreate: ['cron', 'prompt'],
  CronDelete: ['id'],
  CronList: [],
  Edit: ['file_path', 'old_string', 'new_string'],
  EnterPlanMode: [],
  EnterWorktree: [],
  ExitPlanMode: [],
  ExitWorktree: ['action'],
  NotebookEdit: ['notebook_path', 'new_source'],
  Read: ['file_path'],
  ReportFindings: ['findings'],
  ScheduleWakeup: ['delaySeconds', 'reason', 'prompt'],
  SendMessage: ['to', 'message'],
  Skill: ['skill'],
  TaskCreate: ['subject', 'description'],
  TaskGet: ['taskId'],
  TaskList: [],
  TaskOutput: ['task_id', 'block', 'timeout'],
  TaskStop: [],
  TaskUpdate: ['taskId'],
  WebFetch: ['url', 'prompt'],
  WebSearch: ['query'],
  Workflow: [],
  Write: ['file_path', 'content'],
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * True when `requiredParams` is exactly the same set as the reference tool's
 * required params (order-independent). Used to decide whether a name
 * collision is actually the same tool (no rename needed) or a lookalike
 * (needs disambiguation) — see `cc-collision-shape.ts`.
 */
export function matchesReferenceShape(
  ccName: string,
  requiredParams: readonly string[] | undefined
): boolean {
  const reference = CC_TOOL_REFERENCE[ccName];
  if (!reference) return false;
  if (!requiredParams) return false;
  const a = sortedUnique(reference);
  const b = sortedUnique(requiredParams);
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
