/**
 * T3.1 — Inbound parser: Anthropic messages JSON → pi-ai Context + options.
 *
 * Converts the full Anthropic /v1/messages request body into the pi-ai types
 * consumed by the shared executor.
 *
 * Role / content handling:
 *   - `system` (top-level string or ContentBlock[]) → context.systemPrompt.
 *     Multiple text blocks are concatenated with \n\n.
 *   - `user` messages: text → TextContent; base64 images → ImageContent;
 *     URL images → rejected (Stage 2 gap, same policy as Stage 1).
 *     tool_result blocks inside a user turn → ToolResultMessage (emitted
 *     before any remaining non-tool_result content).
 *   - `assistant` messages: text → TextContent; thinking → ThinkingContent
 *     (MUST be preserved for multi-turn extended-thinking conversations);
 *     tool_use → ToolCall.
 *
 * Reasoning: `thinking.budget_tokens` is mapped to an effort bucket via
 * `budgetToEffort`, while the raw budget is preserved on `reasoningIntent` so
 * an Anthropic→Anthropic route can round-trip it without re-quantizing.
 *
 * Tool definitions: Anthropic `{ name, description, input_schema }` mapped
 * through `jsonSchemaToTypeBox`.
 */

import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
  Tool,
} from '@earendil-works/pi-ai';
import { jsonSchemaToTypeBox } from '../../transformers/oauth/type-mappers';
import type { ReasoningIntent } from '../shared/reasoning';
import { budgetToEffort, normalizeVisibility } from '../shared/reasoning';
import type { GenerationIntent } from '../shared/generation';

// ─── Public result type ───────────────────────────────────────────────────────

export interface AnthropicToContextResult {
  context: Context;
  /** Canonical generation intent (reasoning + maxTokens/temperature). */
  generationIntent: GenerationIntent;
  streaming: boolean;
  /** tool_choice forwarded */
  toolChoice?: unknown;
  toolsDefined: number;
  messageCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rejectUrlImage(): never {
  throw Object.assign(
    new Error(
      'URL image content is not supported in the beta inference path. ' +
        'Convert images to base64 before sending.'
    ),
    { routingContext: { statusCode: 400, code: 'unsupported_image_type' } }
  );
}

function parseUserContentBlock(block: any): TextContent | ImageContent | null {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }
  if (block.type === 'image') {
    const src = block.source;
    if (src?.type === 'base64') {
      return { type: 'image', mimeType: src.media_type ?? 'image/jpeg', data: src.data ?? '' };
    }
    if (src?.type === 'url') {
      rejectUrlImage();
    }
  }
  return null; // unknown / skipped block type
}

function parseTools(tools: any[]): Tool[] {
  return tools.map((t) => ({
    name: t.name ?? '',
    description: t.description ?? '',
    parameters: jsonSchemaToTypeBox(t.input_schema ?? {}),
  }));
}

function mapToolChoice(raw: any): unknown | undefined {
  if (!raw) return undefined;
  if (typeof raw !== 'object') return raw;
  // Anthropic: { type: "tool", name: "..." } → pi-ai / OpenAI: { type: "function", function: { name } }
  if (raw.type === 'tool') {
    return { type: 'function', function: { name: raw.name } };
  }
  // "auto" / "any" / "none" → pass string
  if (typeof raw.type === 'string') return raw.type;
  return raw;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function anthropicRequestToContext(body: any): AnthropicToContextResult {
  const piMessages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [];

  // ── System prompt ─────────────────────────────────────────────────────────
  let systemPrompt: string | undefined;
  if (typeof body.system === 'string') {
    systemPrompt = body.system || undefined;
  } else if (Array.isArray(body.system)) {
    const parts = body.system
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text as string)
      .filter(Boolean);
    if (parts.length > 0) systemPrompt = parts.join('\n\n');
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  const rawMessages: any[] = body.messages ?? [];

  for (const msg of rawMessages) {
    if (msg.role === 'user') {
      // Content may be a string or an array of blocks
      if (typeof msg.content === 'string') {
        piMessages.push({
          role: 'user',
          content: msg.content,
          timestamp: Date.now(),
        } as UserMessage);
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Split tool_result blocks out first (each becomes a ToolResultMessage)
      const toolResultBlocks = msg.content.filter((b: any) => b.type === 'tool_result');
      const otherBlocks = msg.content.filter((b: any) => b.type !== 'tool_result');

      for (const tr of toolResultBlocks) {
        const content: (TextContent | ImageContent)[] = [];
        if (typeof tr.content === 'string') {
          content.push({ type: 'text', text: tr.content });
        } else if (Array.isArray(tr.content)) {
          for (const part of tr.content) {
            const parsed = parseUserContentBlock(part);
            if (parsed) content.push(parsed);
          }
        }
        piMessages.push({
          role: 'toolResult',
          toolCallId: tr.tool_use_id ?? '',
          toolName: tr.name ?? '',
          content,
          isError: tr.is_error === true,
          timestamp: Date.now(),
        } as ToolResultMessage);
      }

      // Remaining (text / image) blocks become a UserMessage
      if (otherBlocks.length > 0) {
        const content: (TextContent | ImageContent)[] = [];
        for (const b of otherBlocks) {
          const parsed = parseUserContentBlock(b);
          if (parsed) content.push(parsed);
        }
        if (content.length > 0) {
          piMessages.push({ role: 'user', content, timestamp: Date.now() } as UserMessage);
        }
      }

      continue;
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        const textBlock: TextContent = { type: 'text', text: msg.content };
        piMessages.push({
          role: 'assistant',
          content: [textBlock],
          api: 'anthropic-messages' as any,
          provider: 'anthropic' as any,
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

      if (!Array.isArray(msg.content)) continue;

      const contentBlocks: AssistantMessage['content'] = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          contentBlocks.push({ type: 'text', text: block.text ?? '' } as TextContent);
        } else if (block.type === 'thinking') {
          // Preserve thinking blocks — required for multi-turn extended thinking.
          // The signature must also round-trip or Anthropic rejects the block
          // as tampered/missing on the next turn.
          contentBlocks.push({
            type: 'thinking',
            thinking: block.thinking ?? '',
            ...(block.signature ? { thinkingSignature: block.signature } : {}),
          } as ThinkingContent);
        } else if (block.type === 'tool_use') {
          contentBlocks.push({
            type: 'toolCall',
            id: block.id ?? '',
            name: block.name ?? '',
            arguments: block.input ?? {},
          } as ToolCall);
        }
        // Redacted thinking blocks and other types skipped
      }

      piMessages.push({
        role: 'assistant',
        content: contentBlocks,
        api: 'anthropic-messages' as any,
        provider: 'anthropic' as any,
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
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  const tools =
    Array.isArray(body.tools) && body.tools.length > 0 ? parseTools(body.tools) : undefined;

  const context: Context = {
    systemPrompt,
    messages: piMessages,
    tools,
  };

  // ── Reasoning intent (from thinking config) ──────────────────────────────
  // Anthropic expresses thinking in three ways:
  //   - { type: 'enabled', budget_tokens } → explicit token budget (legacy)
  //   - { type: 'adaptive', display }       → thinking on, model picks magnitude
  //   - { type: 'disabled' }                → explicit off
  // `display` ('summarized' | 'raw') maps to reasoning-output visibility.
  // For 'enabled' we preserve the raw budget so an Anthropic→Anthropic route
  // can round-trip it without re-quantizing.
  let reasoningIntent: ReasoningIntent = { source: 'client' };
  const thinkingType: unknown = body.thinking?.type;
  const visibility = normalizeVisibility(body.thinking?.display);
  if (thinkingType === 'enabled' && body.thinking?.budget_tokens != null) {
    const budget: number = body.thinking.budget_tokens;
    const level = budgetToEffort(budget);
    if (level !== 'off') {
      reasoningIntent = {
        effort: level,
        budgetTokens: budget,
        enabled: true,
        source: 'client',
        ...(visibility ? { visibility } : {}),
      };
    } else {
      reasoningIntent = { enabled: false, source: 'client' };
    }
  } else if (thinkingType === 'adaptive' || thinkingType === 'enabled') {
    // Adaptive (or 'enabled' with no explicit budget): thinking is on and the
    // client did not commit to a magnitude — the model decides. Flag this as
    // `adaptive` rather than pinning an effort, so a native Anthropic adaptive
    // egress can pass `thinkingEnabled: true` through with no effort (true
    // model-decides behavior). Egress families that cannot express adaptive
    // (OpenAI-completions / OpenRouter, Gemini, legacy budget-based Anthropic)
    // flatten it to the documented default effort via intentToEffort — which,
    // critically, is never the reasoning-disabling "none".
    reasoningIntent = {
      adaptive: true,
      enabled: true,
      source: 'client',
      ...(visibility ? { visibility } : {}),
    };
  } else if (thinkingType === 'disabled') {
    reasoningIntent = { enabled: false, source: 'client' };
  }

  // ── Generation intent ─────────────────────────────────────────────────────
  const maxTokens: number | undefined = body.max_tokens ?? undefined;
  const generationIntent: GenerationIntent = {
    reasoning: reasoningIntent,
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
  };

  // Count non-system messages (user + assistant turns)
  const messageCount = piMessages.filter((m) => m.role === 'user' || m.role === 'assistant').length;

  return {
    context,
    generationIntent,
    streaming: body.stream === true,
    toolChoice: mapToolChoice(body.tool_choice),
    toolsDefined: tools?.length ?? 0,
    messageCount,
  };
}
