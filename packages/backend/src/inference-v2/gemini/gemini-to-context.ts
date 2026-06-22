/**
 * T5.1 — Inbound parser: Gemini generateContent JSON → pi-ai Context + options.
 *
 * Converts a Gemini /v1beta/models/:model/generateContent (or :streamGenerateContent)
 * request body into the pi-ai types consumed by the shared executor.
 *
 * Gemini wire format:
 *   - URL encodes the model name — the route handler passes it in body.model.
 *   - `contents: [{ role: "user" | "model", parts: [...] }]`
 *   - Parts: text, inlineData (base64), functionCall, functionResponse.
 *   - `systemInstruction: { parts: [{ text }] }`
 *   - `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`
 *   - `generationConfig.thinkingConfig` → reasoningEffort
 *   - Streaming detected from URL suffix, not body — caller passes `streaming`.
 *
 * Role mapping:
 *   - "user" → UserMessage (text, inlineData) or ToolResultMessage (functionResponse)
 *   - "model" → AssistantMessage (text, functionCall)
 *
 * functionResponse handling:
 *   Gemini encodes tool results as `functionResponse` parts within a `user` role turn.
 *   Each functionResponse becomes a standalone ToolResultMessage emitted BEFORE any
 *   remaining text/image content in that same turn (matching the Anthropic-to-context
 *   pattern for tool_result blocks).
 *
 * Consecutive assistant turns:
 *   Gemini sends parallel tool calls as separate model-role Content objects.
 *   These are merged into a single AssistantMessage (matching request-parser.ts behaviour).
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
import type { ReasoningIntent, ReasoningEffort, ReasoningVisibility } from '../shared/reasoning';
import { budgetToEffort } from '../shared/reasoning';
import type { GenerationIntent } from '../shared/generation';

// ─── Public result type ───────────────────────────────────────────────────────

export interface GeminiToContextResult {
  context: Context;
  /** Canonical generation intent (reasoning + maxTokens/temperature). */
  generationIntent: GenerationIntent;
  /** True when the route URL suffix is :streamGenerateContent */
  streaming: boolean;
  toolsDefined: number;
  messageCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map Gemini thinkingLevel string to pi-ai effort string */
function mapThinkingLevel(level: string | undefined): string | undefined {
  if (!level) return undefined;
  // Gemini uses NONE/LOW/MEDIUM/HIGH (uppercase); also accept lowercase
  switch (level.toUpperCase()) {
    case 'NONE':
      return undefined;
    case 'LOW':
      return 'low';
    case 'MEDIUM':
      return 'medium';
    case 'HIGH':
      return 'high';
    default:
      // Unknown values — treat as high
      return 'high';
  }
}

/** Parse a Gemini Part into a TextContent or ImageContent, or null to skip. */
function parseInlineDataPart(part: any): ImageContent | null {
  const inlineData = part.inlineData;
  if (!inlineData) return null;
  return {
    type: 'image',
    mimeType: inlineData.mimeType ?? 'image/jpeg',
    data: inlineData.data ?? '',
  };
}

/** Convert a functionDeclarations[] entry → pi-ai Tool */
function parseTools(tools: any[]): Tool[] {
  const result: Tool[] = [];
  for (const tool of tools) {
    if (Array.isArray(tool.functionDeclarations)) {
      for (const fn of tool.functionDeclarations) {
        result.push({
          name: fn.name ?? '',
          description: fn.description ?? '',
          parameters: jsonSchemaToTypeBox(fn.parameters ?? fn.parametersJsonSchema ?? {}),
        });
      }
    }
    // Built-in tools (googleSearch, codeExecution, urlContext) have no pi-ai equivalent —
    // skip them silently.
  }
  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function geminiRequestToContext(body: any, streaming: boolean): GeminiToContextResult {
  const contents: any[] = body.contents ?? [];
  const generationConfig = body.generationConfig ?? {};

  // ── System instruction ───────────────────────────────────────────────────
  let systemPrompt: string | undefined;
  if (body.systemInstruction?.parts) {
    const textParts: string[] = [];
    for (const part of body.systemInstruction.parts) {
      if (typeof part.text === 'string' && part.text) textParts.push(part.text);
    }
    if (textParts.length > 0) systemPrompt = textParts.join('\n\n');
  }

  // ── Tools ────────────────────────────────────────────────────────────────
  const tools =
    Array.isArray(body.tools) && body.tools.length > 0 ? parseTools(body.tools) : undefined;

  // ── Reasoning intent (from thinkingConfig) ───────────────────────────────
  // Gemini can speak in either a thinkingLevel string or a thinkingBudget. We
  // preserve the raw budget for round-trip fidelity on Gemini→Gemini routes.
  // `includeThoughts` maps to the unified reasoning visibility.
  let reasoningIntent: ReasoningIntent = { source: 'client' };
  if (generationConfig.thinkingConfig) {
    const tc = generationConfig.thinkingConfig;
    // includeThoughts: true → visible (summary), false → hidden, unset → undefined.
    const visibility: ReasoningVisibility | undefined =
      tc.includeThoughts === true ? 'summary' : tc.includeThoughts === false ? 'hidden' : undefined;
    const withVis = (intent: ReasoningIntent): ReasoningIntent =>
      visibility != null ? { ...intent, visibility } : intent;

    if (tc.thinkingLevel) {
      const mapped = mapThinkingLevel(tc.thinkingLevel);
      reasoningIntent = withVis(
        mapped != null
          ? { effort: mapped as ReasoningEffort, enabled: true, source: 'client' }
          : { enabled: false, source: 'client' }
      );
    } else if (tc.thinkingBudget != null && tc.thinkingBudget > 0) {
      // Budget-based: map token count to effort via the unified threshold table.
      const budget: number = tc.thinkingBudget;
      const level = budgetToEffort(budget);
      reasoningIntent = withVis(
        level !== 'off'
          ? { effort: level, budgetTokens: budget, enabled: true, source: 'client' }
          : { enabled: false, source: 'client' }
      );
    } else if (tc.thinkingBudget === 0) {
      // Explicit budget of 0 disables thinking.
      reasoningIntent = withVis({ enabled: false, source: 'client' });
    } else if (tc.includeThoughts === true) {
      // includeThoughts with no level/budget → default medium
      reasoningIntent = withVis({ effort: 'medium', enabled: true, source: 'client' });
    }
  }

  // ── Generation intent ─────────────────────────────────────────────────────
  const maxTokens: number | undefined = generationConfig.maxOutputTokens ?? undefined;
  const generationIntent: GenerationIntent = {
    reasoning: reasoningIntent,
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(generationConfig.temperature != null ? { temperature: generationConfig.temperature } : {}),
  };

  // ── Message conversion ────────────────────────────────────────────────────
  const piMessages: (UserMessage | AssistantMessage | ToolResultMessage)[] = [];

  for (const content of contents) {
    const role: string = content.role ?? 'user';
    const parts: any[] = content.parts ?? [];

    if (role === 'model') {
      // AssistantMessage — collect text, thinking, and function calls
      const contentBlocks: AssistantMessage['content'] = [];

      for (const part of parts) {
        if (typeof part.text === 'string') {
          if (part.thought === true) {
            // Thinking/reasoning block
            contentBlocks.push({ type: 'thinking', thinking: part.text } as ThinkingContent);
          } else {
            contentBlocks.push({ type: 'text', text: part.text } as TextContent);
          }
        } else if (part.functionCall) {
          const tc: ToolCall = {
            type: 'toolCall',
            id:
              part.functionCall.id ??
              part.functionCall.name ??
              `call_${Math.random().toString(36).slice(2, 9)}`,
            name: part.functionCall.name ?? '',
            arguments: part.functionCall.args ?? {},
          };
          contentBlocks.push(tc);
        }
      }

      // Merge consecutive assistant turns (Gemini sends parallel tool calls as separate turns)
      const prev = piMessages[piMessages.length - 1];
      if (prev && prev.role === 'assistant') {
        const prevAsst = prev as AssistantMessage;
        prevAsst.content = [...prevAsst.content, ...contentBlocks];
      } else {
        piMessages.push({
          role: 'assistant',
          content: contentBlocks,
          api: 'google-generative-ai' as any,
          provider: 'google' as any,
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
      }
    } else {
      // role === "user" — split functionResponse parts into ToolResultMessages first
      const functionResponseParts = parts.filter((p) => p.functionResponse);
      const otherParts = parts.filter((p) => !p.functionResponse);

      // Each functionResponse → ToolResultMessage (emitted before remaining user content)
      for (const fr of functionResponseParts) {
        const responseContent: (TextContent | ImageContent)[] = [
          {
            type: 'text',
            text: JSON.stringify(fr.functionResponse?.response ?? {}),
          },
        ];
        piMessages.push({
          role: 'toolResult',
          toolCallId: fr.functionResponse?.name ?? 'unknown_tool',
          toolName: fr.functionResponse?.name ?? 'unknown_tool',
          content: responseContent,
          isError: false,
          timestamp: Date.now(),
        } as ToolResultMessage);
      }

      // Remaining (text / inlineData) parts → UserMessage
      if (otherParts.length > 0) {
        const userContent: (TextContent | ImageContent)[] = [];
        for (const part of otherParts) {
          if (typeof part.text === 'string') {
            userContent.push({ type: 'text', text: part.text });
          } else if (part.inlineData) {
            const img = parseInlineDataPart(part);
            if (img) userContent.push(img);
          }
          // fileData and other part types skipped
        }

        if (userContent.length > 0) {
          // Simplify to plain string when there's only a single text part
          const firstPart = userContent[0];
          const simpleContent =
            userContent.length === 1 && firstPart?.type === 'text' ? firstPart.text : userContent;
          piMessages.push({
            role: 'user',
            content: simpleContent,
            timestamp: Date.now(),
          } as UserMessage);
        }
      }
    }
  }

  const context: Context = {
    systemPrompt,
    messages: piMessages,
    tools,
  };

  const messageCount = piMessages.filter((m) => m.role === 'user' || m.role === 'assistant').length;

  return {
    context,
    generationIntent,
    streaming,
    toolsDefined: tools?.length ?? 0,
    messageCount,
  };
}
