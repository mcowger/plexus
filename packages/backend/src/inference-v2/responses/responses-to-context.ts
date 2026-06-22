/**
 * T4.1 — Inbound parser: OpenAI Responses API JSON → pi-ai Context + options.
 *
 * By the time this is called, body.input already contains the full concatenated
 * history (state loading — previous_response_id / conversation — happens in the
 * route handler BEFORE this parser is invoked).
 *
 * Input item types handled:
 *   type:"message" role:"system"    → context.systemPrompt
 *   type:"message" role:"user"      → UserMessage (input_text, input_image base64)
 *   type:"message" role:"assistant" → AssistantMessage history (output_text, tool_call)
 *   type:"function_call"            → ToolCall on an AssistantMessage
 *   type:"function_call_output"     → ToolResultMessage
 *
 * Reasoning: body.reasoning.effort → reasoningEffort for buildReasoningOptions.
 * Tools: jsonSchemaToTypeBox (M1.7).
 */

import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ToolCall,
  Tool,
} from '@earendil-works/pi-ai';
import { jsonSchemaToTypeBox } from '../../transformers/oauth/type-mappers';
import type { ReasoningIntent } from '../shared/reasoning';
import { normalizeEffort, normalizeVisibility } from '../shared/reasoning';
import type { GenerationIntent } from '../shared/generation';
import { normalizeVerbosity } from '../shared/generation';

// ─── Public result type ───────────────────────────────────────────────────────

export interface ResponsesToContextResult {
  context: Context;
  /** Canonical generation intent (reasoning + maxTokens/temperature/verbosity/serviceTier). */
  generationIntent: GenerationIntent;
  streaming: boolean;
  toolChoice?: unknown;
  toolsDefined: number;
  messageCount: number;
  /** Whether the client requested a reasoning summary (body.reasoning.summary) */
  wantsSummary: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize Responses API input: string → single user message item */
export function normalizeResponsesInput(input: unknown): any[] {
  if (Array.isArray(input)) {
    return (input as any[]).map((item) => {
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        !('type' in item) &&
        typeof item.role === 'string'
      ) {
        return { type: 'message', ...item };
      }
      return item;
    });
  }
  return [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: String(input ?? '') }],
    },
  ];
}

function parseTools(tools: any[]): Tool[] {
  return tools
    .filter((t) => t.type === 'function' || t.function)
    .map((t) => {
      const fn = t.function ?? t;
      return {
        name: fn.name ?? '',
        description: fn.description ?? '',
        parameters: jsonSchemaToTypeBox(fn.parameters ?? fn.schema ?? {}),
      };
    });
}

function parseToolChoice(raw: any): unknown | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  if (raw.type === 'function') {
    return { type: 'function', function: { name: raw.name ?? raw.function?.name } };
  }
  return raw;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function responsesToContext(body: any): ResponsesToContextResult {
  const items = normalizeResponsesInput(body.input);

  const systemParts: string[] = [];
  const piMessages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [];

  // Accumulate pending tool_calls for the current assistant turn before we
  // encounter a function_call_output that closes it.
  let pendingToolCalls: ToolCall[] = [];
  let pendingTextBlocks: TextContent[] = [];

  const flushAssistantTurn = () => {
    if (pendingTextBlocks.length === 0 && pendingToolCalls.length === 0) return;
    piMessages.push({
      role: 'assistant',
      content: [...pendingTextBlocks, ...pendingToolCalls] as AssistantMessage['content'],
      api: 'openai-responses' as any,
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
    pendingTextBlocks = [];
    pendingToolCalls = [];
  };

  for (const item of items) {
    // ── function_call_output (tool result) ─────────────────────────────────
    if (item.type === 'function_call_output') {
      // Close any pending assistant turn first
      flushAssistantTurn();
      const outputStr =
        typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '');
      piMessages.push({
        role: 'toolResult',
        toolCallId: item.call_id ?? '',
        toolName: item.name ?? '',
        content: [{ type: 'text', text: outputStr }],
        isError: item.is_error === true,
        timestamp: Date.now(),
      } as ToolResultMessage);
      continue;
    }

    // ── function_call (assistant tool call as top-level item) ───────────────
    if (item.type === 'function_call') {
      pendingToolCalls.push({
        type: 'toolCall',
        id: item.call_id ?? item.id ?? '',
        name: item.name ?? '',
        arguments: (() => {
          try {
            return typeof item.arguments === 'string'
              ? JSON.parse(item.arguments)
              : (item.arguments ?? {});
          } catch {
            return {};
          }
        })(),
      } as ToolCall);
      continue;
    }

    // ── message items ───────────────────────────────────────────────────────
    if (item.type !== 'message') continue;

    const role: string = item.role;
    const content: any[] = Array.isArray(item.content)
      ? item.content
      : [{ type: 'input_text', text: String(item.content ?? '') }];

    if (role === 'system' || role === 'developer') {
      const text = content
        .filter((p: any) => p.type === 'input_text' || p.type === 'text')
        .map((p: any) => p.text as string)
        .join('');
      if (text) systemParts.push(text);
      continue;
    }

    if (role === 'user') {
      flushAssistantTurn();
      const userContent: (TextContent | ImageContent)[] = [];
      for (const part of content) {
        if (part.type === 'input_text' || part.type === 'text') {
          userContent.push({ type: 'text', text: part.text ?? '' });
        } else if (part.type === 'input_image') {
          const src = part.image_url ?? part.source;
          if (typeof src === 'string' && src.startsWith('data:')) {
            // base64 data URI
            const commaIdx = src.indexOf(',');
            const header = commaIdx > 0 ? src.slice(5, commaIdx) : '';
            const data = commaIdx > 0 ? src.slice(commaIdx + 1) : src;
            const mimeType = header.split(';')[0] ?? 'image/jpeg';
            userContent.push({ type: 'image', mimeType, data });
          } else if (part.detail && typeof src === 'object' && src?.url) {
            // URL image — rejected same as other stages
            throw Object.assign(
              new Error(
                'URL image content is not supported in the beta inference path. ' +
                  'Convert images to base64 before sending.'
              ),
              { routingContext: { statusCode: 400, code: 'unsupported_image_type' } }
            );
          }
          // Otherwise skip
        }
      }
      if (userContent.length > 0) {
        piMessages.push({
          role: 'user',
          content: userContent,
          timestamp: Date.now(),
        } as UserMessage);
      }
      continue;
    }

    if (role === 'assistant') {
      // Accumulate text and tool_call parts into the pending turn
      for (const part of content) {
        if (part.type === 'output_text' || part.type === 'text') {
          if (part.text) pendingTextBlocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'tool_call' || part.type === 'function_call') {
          pendingToolCalls.push({
            type: 'toolCall',
            id: part.call_id ?? part.id ?? '',
            name: part.name ?? '',
            arguments: (() => {
              try {
                return typeof part.arguments === 'string'
                  ? JSON.parse(part.arguments)
                  : (part.arguments ?? {});
              } catch {
                return {};
              }
            })(),
          } as ToolCall);
        }
        // reasoning / thinking parts skipped (read-only history)
      }
      continue;
    }
  }

  // Flush any remaining pending assistant turn
  flushAssistantTurn();

  // ── Tools ─────────────────────────────────────────────────────────────────
  const tools =
    Array.isArray(body.tools) && body.tools.length > 0 ? parseTools(body.tools) : undefined;

  const context: Context = {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: piMessages,
    tools,
  };

  // ── Reasoning ─────────────────────────────────────────────────────────────
  const wantsSummary: boolean =
    body.reasoning?.summary === 'detailed' || body.reasoning?.summary === 'auto';
  const effortRaw = normalizeEffort(body.reasoning?.effort);
  const summaryDetail: string | undefined =
    typeof body.reasoning?.summary === 'string' ? body.reasoning.summary : undefined;
  const visibility = normalizeVisibility(body.reasoning?.summary);
  const baseReasoning = {
    ...(visibility != null ? { visibility } : {}),
    ...(summaryDetail != null ? { summaryDetail } : {}),
    source: 'client' as const,
  };
  const reasoningIntent: ReasoningIntent =
    effortRaw === 'off'
      ? { ...baseReasoning, enabled: false }
      : effortRaw != null
        ? { ...baseReasoning, effort: effortRaw, enabled: true }
        : baseReasoning;

  // ── Generation intent ─────────────────────────────────────────────────────
  const maxTokens: number | undefined = body.max_output_tokens ?? undefined;
  const generationIntent: GenerationIntent = {
    reasoning: reasoningIntent,
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(normalizeVerbosity(body.text?.verbosity) != null
      ? { verbosity: normalizeVerbosity(body.text?.verbosity) }
      : {}),
    ...(typeof body.service_tier === 'string' ? { serviceTier: body.service_tier } : {}),
  };

  // Count user + assistant turns
  const messageCount = piMessages.filter((m) => m.role === 'user' || m.role === 'assistant').length;

  return {
    context,
    generationIntent,
    streaming: body.stream === true,
    toolChoice: parseToolChoice(body.tool_choice),
    toolsDefined: tools?.length ?? 0,
    messageCount,
    wantsSummary,
  };
}
