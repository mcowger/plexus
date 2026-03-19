/**
 * Claude Code masking service.
 *
 * Encapsulates all logic required to make requests appear as though they
 * originate from a Claude Code CLI session:
 *   1. Proxy non-Claude-Code tool names with a "proxy_" prefix so that the
 *      Anthropic API does not confuse them with its built-in tools.
 *   2. Inject Claude Code specific HTTP request headers.
 *   3. Strip the "proxy_" prefix back out of tool names in responses before
 *      they reach the client.
 *
 * This module works entirely on the project's own Unified request/response
 * types — it has no dependency on pi-ai internals.
 */

import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk,
} from '../types/unified';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tool names that are native to Claude Code and must NOT be prefixed. */
const CLAUDE_CODE_TOOL_NAMES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'KillShell',
  'NotebookEdit',
  'Skill',
  'Task',
  'TaskOutput',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
];

const CLAUDE_CODE_TOOL_SET = new Set(CLAUDE_CODE_TOOL_NAMES.map((n) => n.toLowerCase()));
const CLAUDE_CODE_TOOL_CHOICE_KEYWORDS = new Set(['auto', 'any', 'none', 'required']);
const PROXY_PREFIX = 'proxy_';

/**
 * HTTP headers that make the request look like a Claude Code CLI session.
 * These are merged on top of whatever base headers are already set.
 */
export const CLAUDE_CODE_MASKING_HEADERS: Record<string, string> = {
  'anthropic-beta':
    'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14',
  'user-agent': 'claude-cli/2.1.2 (external, cli)',
  'x-app': 'cli',
};

// ─── Tool name helpers ────────────────────────────────────────────────────────

/** Applies the proxy_ prefix to a tool name unless it is a built-in CC tool. */
export function proxyToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith(PROXY_PREFIX)) return name;
  const lower = name.toLowerCase();
  if (CLAUDE_CODE_TOOL_CHOICE_KEYWORDS.has(lower)) return name;
  if (CLAUDE_CODE_TOOL_SET.has(lower)) return name;
  return `${PROXY_PREFIX}${name}`;
}

/** Strips the proxy_ prefix from a tool name if present. */
export function deproxyToolName(name: string | undefined): string | undefined {
  if (!name) return name;
  return name.startsWith(PROXY_PREFIX) ? name.slice(PROXY_PREFIX.length) : name;
}

// ─── Request masking ─────────────────────────────────────────────────────────

/**
 * Mutates a UnifiedChatRequest in place, prefixing all non-CC tool names with
 * "proxy_" so that Anthropic does not confuse them with its own built-in tools.
 *
 * Affected locations:
 *   - request.tools[].function.name
 *   - assistant messages: message.tool_calls[].function.name
 *   - tool_choice when it references a specific function name
 */
export function applyRequestMasking(request: UnifiedChatRequest): void {
  // Proxy tool definitions
  if (Array.isArray(request.tools)) {
    for (const tool of request.tools) {
      if (tool?.function?.name) {
        tool.function.name = proxyToolName(tool.function.name);
      }
    }
  }

  // Proxy tool_calls in assistant messages
  for (const message of request.messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (tc?.function?.name) {
          tc.function.name = proxyToolName(tc.function.name);
        }
      }
    }
  }

  // Proxy tool_choice when it points to a specific function
  if (
    request.tool_choice &&
    typeof request.tool_choice === 'object' &&
    'function' in request.tool_choice
  ) {
    const tc = request.tool_choice as { type: 'function'; function: { name: string } };
    if (tc.function?.name) {
      tc.function.name = proxyToolName(tc.function.name);
    }
  }
}

// ─── Response deproxy (non-streaming) ────────────────────────────────────────

/**
 * Mutates a UnifiedChatResponse in place, stripping the "proxy_" prefix from
 * tool call names so clients receive the original tool names they sent.
 */
export function deproxyResponse(response: UnifiedChatResponse): void {
  if (Array.isArray(response.tool_calls)) {
    for (const tc of response.tool_calls) {
      if (tc?.function?.name) {
        tc.function.name = deproxyToolName(tc.function.name) ?? tc.function.name;
      }
    }
  }
}

// ─── Stream deproxy (streaming) ──────────────────────────────────────────────

/**
 * Wraps a stream of UnifiedChatStreamChunk objects, stripping the "proxy_"
 * prefix from tool_call delta function names before they reach the client.
 *
 * The stream must already be in unified chunk format (output of
 * transformer.transformStream). This should be piped before formatStream.
 */
export function createDeproxyTransformStream(
  source: ReadableStream<UnifiedChatStreamChunk>
): ReadableStream<UnifiedChatStreamChunk> {
  const transformer = new TransformStream<UnifiedChatStreamChunk, UnifiedChatStreamChunk>({
    transform(chunk, controller) {
      if (chunk?.delta?.tool_calls) {
        for (const tc of chunk.delta.tool_calls) {
          if (tc?.function?.name) {
            tc.function.name = deproxyToolName(tc.function.name) ?? tc.function.name;
          }
        }
      }
      controller.enqueue(chunk);
    },
  });
  return source.pipeThrough(transformer);
}
