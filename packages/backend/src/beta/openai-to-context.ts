/**
 * Beta inference path — inbound conversion.
 *
 * Converts a raw OpenAI chat-completions request body directly into a pi-ai
 * `Context` plus a strongly-typed options object. This is the ONE inbound
 * conversion pi-ai does not provide (pi-ai owns outbound Context -> wire-format
 * transformation, but callers are expected to build the Context themselves).
 *
 * This module deliberately depends only on `@earendil-works/pi-ai` types and the
 * raw OpenAI JSON shape — it never imports the legacy Unified* types. The logic
 * mirrors `transformers/oauth/type-mappers.ts` but operates on OpenAI JSON.
 */
import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  Tool as PiAiTool,
  Api,
  Provider,
} from '@earendil-works/pi-ai';
import { jsonSchemaToTypeBox } from '../transformers/oauth/type-mappers';

/** Subset of an OpenAI chat-completions request body we care about. */
export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  [key: string]: unknown;
}

interface OpenAIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Basic per-request options extracted from the OpenAI request body.
 *  Reasoning/thinking is handled separately in run.ts via streamSimple's
 *  ThinkingLevel — not mapped here. */
export interface BetaRequestOptions {
  temperature?: number;
  maxTokens?: number;
  toolChoice?: unknown;
}

function extractText(content: string | OpenAIContentPart[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function toUserContent(
  content: string | OpenAIContentPart[] | null | undefined
): string | (TextContent | ImageContent)[] {
  if (content == null) return '';
  if (typeof content === 'string') return content;

  const parts: (TextContent | ImageContent)[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image_url') {
      const url = block.image_url.url;
      if (url.startsWith('data:')) {
        const [header = '', data = ''] = url.split(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mimeType = mimeMatch ? mimeMatch[1]! : 'image/png';
        parts.push({ type: 'image', data, mimeType } as ImageContent);
      } else {
        // pi-ai providers require base64 images on this path; skip raw URLs.
        throw new Error('Beta path requires base64-encoded images, not URLs');
      }
    }
  }
  return parts;
}

function userMessage(msg: OpenAIMessage): UserMessage {
  return {
    role: 'user',
    content: toUserContent(msg.content),
    timestamp: Date.now(),
  } as UserMessage;
}

function assistantMessage(
  msg: OpenAIMessage,
  provider: Provider,
  model: string,
  api: Api
): AssistantMessage {
  const content: AssistantMessage['content'] = [];

  const text = extractText(msg.content);
  if (text) content.push({ type: 'text', text });

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = { _raw: tc.function.arguments };
      }
      content.push({ type: 'toolCall', id: tc.id, name: tc.function.name, arguments: args });
    }
  }

  return {
    role: 'assistant',
    content,
    api,
    provider,
    model,
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
  } as AssistantMessage;
}

function toolResultMessage(msg: OpenAIMessage): ToolResultMessage {
  const text = extractText(msg.content);
  return {
    role: 'toolResult',
    toolCallId: msg.tool_call_id ?? 'unknown',
    toolName: msg.name ?? 'unknown',
    content: text ? [{ type: 'text', text }] : [],
    isError: false,
    timestamp: Date.now(),
  } as ToolResultMessage;
}

function toPiAiTool(tool: OpenAITool): PiAiTool {
  const rawSchema = tool.function.parameters ?? {};
  const parameters = jsonSchemaToTypeBox({ type: 'object', ...rawSchema });
  return {
    name: tool.function.name,
    description: tool.function.description ?? '',
    parameters,
  } as PiAiTool;
}

export function openaiRequestToContext(
  body: OpenAIChatRequest,
  target: { provider: Provider; model: string; api: Api }
): { context: Context; options: BetaRequestOptions } {
  const context: Context = {
    messages: [],
    tools: body.tools?.filter((t) => t.function).map(toPiAiTool),
  };

  for (const msg of body.messages ?? []) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = extractText(msg.content);
      if (text)
        context.systemPrompt = context.systemPrompt ? `${context.systemPrompt}\n\n${text}` : text;
    } else if (msg.role === 'user') {
      context.messages.push(userMessage(msg));
    } else if (msg.role === 'assistant') {
      context.messages.push(assistantMessage(msg, target.provider, target.model, target.api));
    } else if (msg.role === 'tool') {
      context.messages.push(toolResultMessage(msg));
    }
  }

  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  const options: BetaRequestOptions = {
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(body.tool_choice != null ? { toolChoice: body.tool_choice } : {}),
  };

  return { context, options };
}
