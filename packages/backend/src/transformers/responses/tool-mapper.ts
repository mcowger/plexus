import { ResponsesOutputItem } from '../../types/responses';
import { generateItemId } from './utils';

export interface ResponsesToolState {
  namespaceMap: Map<string, { namespace: string; name: string }>;
  customToolNames: Set<string>;
  /** Every flat function name the model is given, for resolving history/output names. */
  toolNames: Set<string>;
}

export function createResponsesToolState(): ResponsesToolState {
  return {
    namespaceMap: new Map(),
    customToolNames: new Set(),
    toolNames: new Set(),
  };
}

export function clearResponsesToolState(state: ResponsesToolState): void {
  state.namespaceMap.clear();
  state.customToolNames.clear();
  state.toolNames.clear();
}

/**
 * The flat name of the only namespaced sub-tool called `name`, if exactly one
 * exists. OpenAI returns (and Codex replays) a call to a tool in Codex's
 * default `functions` namespace without its namespace — e.g. a custom
 * `exec` call — so a bare name can still address a namespaced tool.
 */
function uniqueNamespacedToolName(name: string, state: ResponsesToolState): string | undefined {
  let match: string | undefined;
  for (const [flatName, entry] of state.namespaceMap) {
    if (entry.name !== name) continue;
    if (match) return undefined;
    match = flatName;
  }
  return match;
}

/**
 * Resolves a function_call / custom_tool_call history item to the flat tool
 * name the model was given. Accepts every namespace spelling clients send:
 * `{namespace, name}` (Codex), `name: "<namespace>.<name>"` (Muse Code), or a
 * bare sub-tool name (OpenAI's default-namespace calls).
 */
export function resolveHistoryToolName(
  name: string,
  namespace: string | undefined,
  state?: ResponsesToolState
): string {
  if (namespace) return `${namespace}__${name}`;
  if (!state || typeof name !== 'string' || state.toolNames.has(name)) return name;

  const dot = name.indexOf('.');
  if (dot > 0) {
    const dotted = `${name.slice(0, dot)}__${name.slice(dot + 1)}`;
    if (state.namespaceMap.has(dotted)) return dotted;
  }

  return uniqueNamespacedToolName(name, state) ?? name;
}

export interface ResolvedToolCall {
  type: 'function_call' | 'custom_tool_call';
  /** Flat name the model used, after resolving provider-side spellings. */
  flatName: string;
  name: string;
  namespace?: string;
}

/**
 * Splits a model-generated flat tool name back into the Responses output
 * shape the client declared: namespace-qualified function calls, and custom
 * tools (top-level or nested in a namespace) as custom_tool_call. Custom
 * calls carry only the sub-tool name, matching OpenAI's own output.
 */
export function resolveOutputToolCall(
  rawFlatName: string,
  state?: ResponsesToolState
): ResolvedToolCall {
  const flatName =
    state && !state.toolNames.has(rawFlatName)
      ? (uniqueNamespacedToolName(rawFlatName, state) ?? rawFlatName)
      : rawFlatName;
  const namespaced = state?.namespaceMap.get(flatName);

  if (state?.customToolNames.has(flatName)) {
    return { type: 'custom_tool_call', flatName, name: namespaced?.name ?? flatName };
  }
  if (namespaced) {
    return {
      type: 'function_call',
      flatName,
      name: namespaced.name,
      namespace: namespaced.namespace,
    };
  }
  return { type: 'function_call', flatName, name: flatName };
}

/**
 * Wraps a custom tool's raw string input into the JSON arguments shape a
 * function-calling model expects, matching codex-ollama-proxy's
 * `customToolArgumentsForModel`.
 */
export function customToolArgumentsForModel(input: unknown): string {
  return JSON.stringify({ input: typeof input === 'string' ? input : JSON.stringify(input) });
}

/**
 * Unwraps a model-generated function_call's JSON arguments back into the
 * raw string input a custom_tool_call expects, matching
 * codex-ollama-proxy's `customToolInput`. Handles:
 * - a plain string that already looks like a patch/raw input
 * - `{ input: string }` (the shape we ask the model to produce)
 * - `{ command: [..., patchBody] }` tuple form some models emit
 * - any other object: falls back to the first string-valued property
 */
export function customToolInput(rawArguments: string): string {
  if (typeof rawArguments !== 'string') {
    return rawArguments == null ? '' : String(rawArguments);
  }

  const trimmed = rawArguments.trim();
  if (trimmed.startsWith('*** Begin Patch')) {
    return rawArguments;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return rawArguments;
  }

  if (typeof parsed === 'string') {
    return parsed;
  }

  if (parsed && typeof parsed === 'object') {
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.input === 'string') {
      return candidate.input;
    }
    if (Array.isArray(candidate.command)) {
      const last = candidate.command[candidate.command.length - 1];
      if (typeof last === 'string') {
        return last;
      }
    }
    for (const value of Object.values(candidate)) {
      if (typeof value === 'string') {
        return value;
      }
    }
  }

  return rawArguments;
}

/**
 * Converts incoming Responses API tools to unified format.
 * Function tools are reformatted; non-function tools (built-in server-side
 * tools like web_search, web_search_20250305, openrouter:web_search) are
 * passed through as-is so provider adapters can coerce them.
 *
 * Codex CLI extensions:
 * - `type: "namespace"` tools group sub-tools; most providers only
 *   understand flat function tools, so each sub-tool is flattened to
 *   `${namespace}__${name}` and recorded in namespaceMap for split-back
 *   in convertChatResponseToOutputItems/formatStream.
 * - `type: "custom"` tools (e.g. apply_patch) take raw string input rather
 *   than JSON-schema arguments; they're exposed to the model as a function
 *   tool with a single `input: string` argument, matching the wire shape
 *   codex-ollama-proxy's `customToolArgumentsForModel` sends
 *   (`JSON.stringify({ input })`). The name is recorded in
 *   customToolNames so the response side can convert back to
 *   custom_tool_call and unwrap the argument via customToolInput().
 */
export function convertToolsForUnified(tools: any[], state?: ResponsesToolState): any[] {
  const result: any[] = [];

  const pushCustom = (name: string, description: string | undefined) => {
    state?.customToolNames.add(name);
    state?.toolNames.add(name);
    result.push({
      type: 'function',
      function: {
        name,
        description: description || '',
        parameters: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      },
    });
  };

  for (const tool of tools) {
    if (tool.type === 'namespace') {
      for (const subTool of tool.tools || []) {
        const flatName = `${tool.name}__${subTool.name}`;
        state?.namespaceMap.set(flatName, { namespace: tool.name, name: subTool.name });
        // Codex lite nests custom tools (e.g. `exec`) inside its `functions`
        // namespace; they keep raw-string input like top-level custom tools.
        if (subTool.type === 'custom') {
          pushCustom(flatName, subTool.description);
          continue;
        }
        state?.toolNames.add(flatName);
        result.push({
          type: 'function',
          function: {
            name: flatName,
            description: subTool.description || '',
            parameters: subTool.parameters || {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            strict: subTool.strict,
          },
        });
      }
      continue;
    }

    if (tool.type === 'custom') {
      pushCustom(tool.name, tool.description);
      continue;
    }

    if (tool.type !== 'function') {
      result.push(tool);
      continue;
    }

    state?.toolNames.add(tool.name);
    result.push({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict,
      },
    });
  }
  return result;
}

/**
 * Filters out built-in tools and converts function tools.
 * Used when routing Responses API → Chat Completions (outbound transform).
 */
export function convertToolsForChatCompletions(tools: any[]): any[] {
  return tools
    .filter((tool) => tool.type === 'function')
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict,
      },
    }));
}

/**
 * Converts tool_choice to Chat Completions format
 */
export function convertToolChoiceForChatCompletions(toolChoice: any): any {
  if (typeof toolChoice === 'string') {
    return toolChoice;
  }
  if (toolChoice?.type === 'function') {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    };
  }
  return 'auto';
}

/**
 * Converts a single Chat-Completions-style tool call back into a Responses
 * API output item, splitting namespace-flattened names back to
 * `{namespace, name}` and converting custom tool calls back to
 * custom_tool_call with unwrapped string input (customToolInput).
 */
export function buildToolOutputItem(
  toolCall: {
    id: string;
    function: { name: string; arguments: string };
  },
  state?: ResponsesToolState
): ResponsesOutputItem {
  const resolved = resolveOutputToolCall(toolCall.function.name, state);

  if (resolved.type === 'custom_tool_call') {
    return {
      type: 'custom_tool_call',
      id: generateItemId('fc'),
      status: 'completed',
      call_id: toolCall.id,
      name: resolved.name,
      input: customToolInput(toolCall.function.arguments),
    };
  }

  return {
    type: 'function_call',
    id: generateItemId('fc'),
    status: 'completed',
    call_id: toolCall.id,
    name: resolved.name,
    ...(resolved.namespace ? { namespace: resolved.namespace } : {}),
    arguments: toolCall.function.arguments,
  };
}
