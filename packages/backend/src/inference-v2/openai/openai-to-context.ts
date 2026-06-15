/**
 * T2.1 — Inbound parser: OpenAI chat-completions JSON → pi-ai Context + ProviderStreamOptions.
 *
 * Converts the full OpenAI chat-completions request body into the pi-ai types that
 * `pi-ai-executor.ts` needs.  It is intentionally wire-format-agnostic on the output side —
 * the executor passes the result to pi-ai directly without knowing the original wire format.
 *
 * Role handling:
 *   - system / developer  → collapsed into context.systemPrompt (concatenated with \n\n)
 *   - user                → UserMessage with text and base64 image content
 *   - assistant           → AssistantMessage with text + tool calls
 *   - tool                → ToolResultMessage
 *
 * URL images are rejected with an error (Stage 1 gap, see DESIGN.md).
 */

import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ToolCall,
  ProviderStreamOptions,
  Tool,
} from '@earendil-works/pi-ai';
import { jsonSchemaToTypeBox } from '../../transformers/oauth/type-mappers';

// ─── public result type ───────────────────────────────────────────────────────

export interface OpenAIToContextResult {
  /** The pi-ai conversation context */
  context: Context;
  /**
   * Options fragment from the request body (temperature, maxTokens, toolChoice,
   * parallelToolCalls).  reasoning_effort is not included here — the executor
   * resolves it via buildReasoningOptions at call time.
   */
  streamOptions: Omit<ProviderStreamOptions, 'apiKey' | 'signal' | 'onPayload' | 'headers'>;
  /** True when the request body has stream: true */
  streaming: boolean;
  /** reasoning_effort value forwarded from the request body, if present */
  reasoningEffort?: string;
  /** tool_choice forwarded verbatim */
  toolChoice?: string | { type: string; function?: { name: string } };
  /** parallel_tool_calls forwarded verbatim */
  parallelToolCalls?: boolean;
  /** Number of tools defined (for usage recording) */
  toolsDefined: number;
  /** Number of non-system messages (for usage recording) */
  messageCount: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseUserContent(content: unknown): string | (TextContent | ImageContent)[] {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return String(content ?? '');
  }

  const parts: (TextContent | ImageContent)[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text ?? '' });
    } else if (part.type === 'image_url') {
      const urlOrObj = part.image_url;
      const url: string = typeof urlOrObj === 'string' ? urlOrObj : (urlOrObj?.url ?? '');
      if (url.startsWith('data:')) {
        // base64 data URI
        const commaIdx = url.indexOf(',');
        const header = commaIdx > 0 ? url.slice(5, commaIdx) : '';
        const data = commaIdx > 0 ? url.slice(commaIdx + 1) : url;
        const mimeType = header.split(';')[0] ?? 'image/jpeg';
        parts.push({ type: 'image', mimeType, data });
      } else {
        // URL images rejected in Stage 1
        throw Object.assign(
          new Error(
            'URL image content is not supported in the beta inference path. ' +
              'Please convert images to base64 before sending.'
          ),
          { routingContext: { statusCode: 400, code: 'unsupported_image_type' } }
        );
      }
    }
    // other content types (e.g. refusal) are silently skipped
  }
  return parts;
}

function parseAssistantContent(message: any): { textParts: TextContent[]; toolCalls: ToolCall[] } {
  const textParts: TextContent[] = [];
  const toolCalls: ToolCall[] = [];

  if (typeof message.content === 'string' && message.content) {
    textParts.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text' && part.text) {
        textParts.push({ type: 'text', text: part.text });
      }
    }
  }

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      toolCalls.push({
        type: 'toolCall',
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        arguments: (() => {
          try {
            return JSON.parse(tc.function?.arguments ?? '{}');
          } catch {
            return {};
          }
        })(),
      });
    }
  }

  return { textParts, toolCalls };
}

function parseToolResult(message: any): ToolResultMessage {
  const content: (TextContent | ImageContent)[] = [];
  if (typeof message.content === 'string') {
    content.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text ?? '' });
      }
    }
  }
  return {
    role: 'toolResult',
    toolCallId: message.tool_call_id ?? '',
    toolName: message.name ?? '',
    content,
    isError: false,
    timestamp: Date.now(),
  };
}

function parseTools(tools: any[]): Tool[] {
  return tools.map((t) => ({
    name: t.function?.name ?? t.name ?? '',
    description: t.function?.description ?? t.description ?? '',
    parameters: jsonSchemaToTypeBox(t.function?.parameters ?? t.parameters ?? {}),
  }));
}

// ─── main export ──────────────────────────────────────────────────────────────

export function openaiRequestToContext(body: any): OpenAIToContextResult {
  const messages: any[] = body.messages ?? [];

  const systemParts: string[] = [];
  const piMessages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [];

  for (const msg of messages) {
    const role: string = msg.role;

    if (role === 'system' || role === 'developer') {
      // Collapse multiple system/developer messages into systemPrompt
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('')
            : String(msg.content ?? '');
      if (text) systemParts.push(text);
      continue;
    }

    if (role === 'user') {
      const content = parseUserContent(msg.content);
      piMessages.push({
        role: 'user',
        content,
        timestamp: Date.now(),
      } as UserMessage);
      continue;
    }

    if (role === 'assistant') {
      const { textParts, toolCalls } = parseAssistantContent(msg);
      piMessages.push({
        role: 'assistant',
        content: [...textParts, ...toolCalls] as AssistantMessage['content'],
        // These fields are required by AssistantMessage but we're constructing
        // a history entry so use placeholders that pi-ai accepts for context.
        api: 'openai-completions' as any,
        provider: 'openai' as any,
        model: body.model ?? '',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as AssistantMessage);
      continue;
    }

    if (role === 'tool') {
      piMessages.push(parseToolResult(msg));
      continue;
    }

    // Unknown roles — skip silently
  }

  const context: Context = {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: piMessages,
    tools: Array.isArray(body.tools) && body.tools.length > 0 ? parseTools(body.tools) : undefined,
  };

  const maxTokens: number | undefined = body.max_completion_tokens ?? body.max_tokens ?? undefined;

  const streamOptions: OpenAIToContextResult['streamOptions'] = {
    temperature: body.temperature ?? undefined,
    ...(maxTokens != null ? { maxTokens } : {}),
  };

  return {
    context,
    streamOptions,
    streaming: body.stream === true,
    reasoningEffort: body.reasoning_effort ?? undefined,
    toolChoice: body.tool_choice ?? undefined,
    parallelToolCalls: body.parallel_tool_calls ?? undefined,
    toolsDefined: context.tools?.length ?? 0,
    messageCount: piMessages.length,
  };
}
