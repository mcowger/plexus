/**
 * Claude Code fingerprint constants — v2-native.
 *
 * Ported from vendor/eliza/plugins/plugin-anthropic-proxy/src/proxy/
 * constants.ts (which itself is a byte-for-byte port of Shadow's
 * `openclaw-routing-layer/proxy.js` v2.2.3) and de-vendored so v2 no longer
 * depends on the eliza plugin. Only the OAuth-masking pipeline actually
 * needed anything from that plugin — v1 (transformers/oauth/oauth-
 * claude.ts) proves the eliza dependency was never load-bearing for Claude
 * Code fingerprinting in general, and roughly half of what the vendored
 * pipeline did was already a no-op for non-eliza clients (see this file's
 * git history / apply-masking.ts for the audit).
 *
 * These are upstream-detection-bypass surface: the values below encode
 * what a genuine Claude Code CLI session's requests look like, and MUST
 * match reality or Anthropic's abuse detection flags the traffic as
 * non-CC (see debug traces 1e0a037d-54a2-4358-ac53-75ade3a1f875,
 * 7754cf0d-f083-44d2-8e57-fe41ce1f7592, 17404760-e986-49b3-8a20-
 * f1a4a469a0ac for the failure modes each of these fixes). Each constant
 * below documents where to look if it ever needs updating.
 */

/**
 * Claude Code CLI version string to emulate in the billing header's
 * cc_version and the `user-agent`/`claude-cli` headers.
 *
 * SOURCE: vendor/eliza's CC_VERSION, itself kept in sync with whatever
 * Claude Code version was current when that constant was last updated.
 * TO UPDATE: install the real `claude` CLI and run `claude --version`, or
 * inspect a genuine Claude Code session's `user-agent` header
 * (`claude-cli/<version> (external, cli)`).
 */
export const CC_VERSION = '2.1.97';

/**
 * Billing fingerprint salt + character-index selection, used to compute the
 * `cc_version` build-hash suffix (e.g. the ".a7c" in "2.1.97.a7c").
 *
 * SOURCE: vendor/eliza's BILLING_HASH_SALT / BILLING_HASH_INDICES, whose
 * comment claims these match real Claude Code's `utils/fingerprint.ts`
 * computeFingerprint() algorithm (SHA256 over specific character indices of
 * the first user message, salted, truncated to 3 hex chars). Never
 * independently verified byte-for-byte against real CC — if Anthropic
 * starts rejecting this suffix specifically, the salt/indices are the first
 * thing to re-derive from a genuine Claude Code CLI network capture.
 * TO UPDATE: capture a real Claude Code request, extract the cc_version
 * suffix, and work backward from the known algorithm shape (see
 * cc-billing.ts's `computeFingerprint`).
 */
export const BILLING_HASH_SALT = '59cf53e54c78';
export const BILLING_HASH_INDICES: readonly number[] = [4, 7, 20];

/**
 * `anthropic-beta` feature flags real Claude Code sends on every OAuth
 * request. pi-ai's own OAuth client (`@earendil-works/pi-ai`, `dist/api/
 * anthropic-messages.js`, `createClient()`) only sets 2 of these
 * (`claude-code-20250219`, `oauth-2025-04-20`) plus whatever interleaved-
 * thinking/fine-grained-streaming flags apply to the model — see
 * pi-ai-executor.ts, which overrides pi-ai's header via `options.headers`
 * (the last-merged / overriding source in pi-ai's `mergeHeaders()`).
 *
 * SOURCE: vendor/eliza's REQUIRED_BETAS.
 * TO UPDATE: inspect a genuine Claude Code CLI request's `anthropic-beta`
 * header (comma-separated feature flags); Anthropic also documents current
 * beta flags at https://docs.claude.com/en/api/beta-headers as they're
 * introduced/retired.
 */
export const REQUIRED_BETAS: readonly string[] = [
  'oauth-2025-04-20',
  'claude-code-20250219',
  'interleaved-thinking-2025-05-14',
  'advanced-tool-use-2025-11-20',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24',
  'fast-mode-2026-02-01',
];

/**
 * Synthetic Claude Code tool stubs injected into the outgoing `tools[]` so
 * the tool set fingerprints like a real Claude Code session even when the
 * caller's own tool surface doesn't include them. Their schemas are
 * intentionally minimal — the model isn't expected to call these, they only
 * need to exist in the tool list.
 *
 * SOURCE: vendor/eliza's CC_SYNTHETIC_TOOLS (itself ported from
 * proxy.js v2.2.3's inline tool-array insertion).
 * TO UPDATE: a genuine Claude Code session's `tools[]` array contains the
 * full real tool set (see pi-ai's own `claudeCodeTools` list in
 * anthropic-messages.js for the 17 canonical names, sourced from
 * https://cchistory.mariozechner.at/data/prompts-2.1.11.md /
 * https://github.com/badlogic/cchistory) — these 5 are the subset most
 * likely to be MISSING from a third-party client's own tool surface and
 * therefore worth padding in. Add/remove entries here if a captured real CC
 * session's tool list diverges.
 */
export const CC_SYNTHETIC_TOOLS: readonly {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}[] = [
  {
    name: 'Glob',
    description: 'Find files by pattern',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Glob pattern' } },
      required: ['pattern'],
    },
  },
  {
    name: 'Grep',
    description: 'Search file contents',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Search path' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Agent',
    description: 'Launch a subagent for complex tasks',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'Task description' } },
      required: ['prompt'],
    },
  },
  {
    name: 'NotebookEdit',
    description: 'Edit notebook cells',
    input_schema: {
      type: 'object',
      properties: { notebook_path: { type: 'string' }, cell_index: { type: 'integer' } },
      required: ['notebook_path'],
    },
  },
  {
    name: 'TodoRead',
    description: 'Read current task list',
    input_schema: { type: 'object', properties: {} },
  },
];
