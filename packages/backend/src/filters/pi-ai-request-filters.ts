import type { Context, Model as PiAiModel, OAuthProvider } from '@mariozechner/pi-ai';
import { PI_AI_REQUEST_FILTERS } from './pi-ai-request-filter-rules';

export interface PiAiRequestFilterRule {
  provider: OAuthProvider | string;
  model: string;
  strippedParameters: string[];
  comment: string;
}

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
  'WebSearch'
];

const CLAUDE_CODE_TOOL_SET = new Set(CLAUDE_CODE_TOOL_NAMES.map((name) => name.toLowerCase()));
const CLAUDE_CODE_TOOL_CHOICE_KEYWORDS = new Set(['auto', 'any', 'none', 'required']);
const PROXY_TOOL_PREFIX = 'proxy_';

export function proxyClaudeCodeToolName(name: string): string {
  if (!name) return name;
  if (name.startsWith(PROXY_TOOL_PREFIX)) return name;
  const lower = name.toLowerCase();
  if (CLAUDE_CODE_TOOL_CHOICE_KEYWORDS.has(lower)) return name;
  if (CLAUDE_CODE_TOOL_SET.has(lower)) return name;
  return `${PROXY_TOOL_PREFIX}${name}`;
}

export function applyClaudeCodeToolProxy(context: Context): {
  proxiedCount: number;
  proxiedNames: string[];
} {
  let proxiedCount = 0;
  const proxiedNames: string[] = [];

  const trackProxy = (before: string, after: string) => {
    if (before !== after) {
      proxiedCount += 1;
      if (proxiedNames.length < 12) {
        proxiedNames.push(`${before} -> ${after}`);
      }
    }
  };

  if (Array.isArray(context.tools)) {
    for (const tool of context.tools) {
      if (!tool?.name) continue;
      const before = tool.name;
      const after = proxyClaudeCodeToolName(before);
      if (after !== before) {
        tool.name = after;
        trackProxy(before, after);
      }
    }
  }

  for (const message of context.messages) {
    if (message?.role === 'assistant' && Array.isArray((message as any).content)) {
      for (const block of (message as any).content) {
        if (block?.type === 'toolCall' && typeof block.name === 'string') {
          const before = block.name;
          const after = proxyClaudeCodeToolName(before);
          if (after !== before) {
            block.name = after;
            trackProxy(before, after);
          }
        }
      }
    }

    if (message?.role === 'toolResult' && typeof (message as any).toolName === 'string') {
      const before = (message as any).toolName;
      const after = proxyClaudeCodeToolName(before);
      if (after !== before) {
        (message as any).toolName = after;
        trackProxy(before, after);
      }
    }
  }

  return { proxiedCount, proxiedNames };
}

export function filterPiAiRequestOptions(
  options: Record<string, unknown>,
  model: PiAiModel<any>
): { filteredOptions: Record<string, unknown>; strippedParameters: string[] } {
  const matches = PI_AI_REQUEST_FILTERS.filter(
    (rule: PiAiRequestFilterRule) => rule.provider === model.provider && rule.model === model.id
  );

  if (matches.length === 0) {
    return { filteredOptions: options, strippedParameters: [] };
  }

  const filteredOptions = { ...options };
  const stripped = new Set<string>();

  for (const rule of matches) {
    for (const param of rule.strippedParameters) {
      if (param in filteredOptions) {
        delete filteredOptions[param];
        stripped.add(param);
      }
    }
  }

  return { filteredOptions, strippedParameters: Array.from(stripped) };
}
