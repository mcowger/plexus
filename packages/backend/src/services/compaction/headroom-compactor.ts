/**
 * headroom-compactor.ts
 *
 * Compaction strategy that uses the headroom-ai SDK to compress context.
 * Maps pi-ai messages → OpenAI format, calls compress(), maps back to pi-ai.
 *
 * Design notes:
 * - systemPrompt is NOT forwarded (protected from compression).
 * - toolName cannot be represented in OpenAI format; we restore it via
 *   a toolCallId→toolName map built from the original context.
 * - thinking/timestamp/usage are dropped on the way to OpenAI; reconstructed
 *   with zero/placeholder values on the way back.
 * - Any error from compressFn propagates — the CompactionService fails open.
 */
import { compress as sdkCompress } from 'headroom-ai';
import type { CompressOptions, CompressResult } from 'headroom-ai';
import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ToolCall,
  Message,
  Usage,
} from '@earendil-works/pi-ai';
import type {
  CompactionStrategy,
  CompactionStrategyContext,
  ResolvedCompactionSettings,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompressFn = (messages: any[], options?: CompressOptions) => Promise<CompressResult>;

/** Minimal OpenAI message shapes (mirrors headroom-ai's OpenAIMessage union). */
type OAISystem = { role: 'system'; content: string };
type OAIUser = { role: 'user'; content: string | OAIContentPart[] };
type OAIAssistant = { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] };
type OAITool = { role: 'tool'; content: string; tool_call_id: string };
type OAIMessage = OAISystem | OAIUser | OAIAssistant | OAITool;

type OAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

type OAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/** Template used to reconstruct pi-ai AssistantMessage required fields. */
interface AssistantTemplate {
  api: string;
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Zero values
// ---------------------------------------------------------------------------

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

// ---------------------------------------------------------------------------
// toOpenAI — pi-ai message → OpenAI message
// ---------------------------------------------------------------------------

/**
 * Map a single pi-ai Message to an OpenAI-format message object.
 * Exported for unit testing.
 */
export function toOpenAI(msg: Message): OAIMessage {
  if (msg.role === 'user') {
    const m = msg as UserMessage;
    if (typeof m.content === 'string') {
      return { role: 'user', content: m.content };
    }
    // Array of TextContent | ImageContent
    const parts: OAIContentPart[] = (m.content as (TextContent | ImageContent)[]).map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      // image → image_url with data URI
      return {
        type: 'image_url',
        image_url: { url: `data:${block.mimeType};base64,${block.data}` },
      };
    });
    return { role: 'user', content: parts };
  }

  if (msg.role === 'assistant') {
    const m = msg as AssistantMessage;
    const textBlocks = (m.content as (TextContent | { type: string })[]).filter(
      (b): b is TextContent => b.type === 'text'
    );
    const toolCallBlocks = (m.content as { type: string }[]).filter(
      (b): b is ToolCall => b.type === 'toolCall'
    );

    const content: string | null =
      textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('') : null;

    const tool_calls: OAIToolCall[] = toolCallBlocks.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));

    if (tool_calls.length > 0) {
      return { role: 'assistant', content, tool_calls };
    }
    return { role: 'assistant', content };
  }

  if (msg.role === 'toolResult') {
    const m = msg as ToolResultMessage;
    const content = (m.content as (TextContent | ImageContent)[])
      .filter((b): b is TextContent => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { role: 'tool', tool_call_id: m.toolCallId, content };
  }

  // Unreachable for valid pi-ai Messages, but satisfy TS exhaustiveness.
  throw new Error(`HeadroomCompactor: unknown pi-ai message role: ${(msg as any).role}`);
}

// ---------------------------------------------------------------------------
// fromOpenAI — OpenAI message → pi-ai Message
// ---------------------------------------------------------------------------

/** Try JSON.parse; return {} on failure. */
function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Map a single OpenAI-format message back to a pi-ai Message.
 * Exported for unit testing.
 *
 * @param msg           - The OpenAI-format message from headroom's CompressResult.
 * @param toolNameById  - Map of toolCallId → toolName (built from original context).
 * @param template      - api/provider/model to use for reconstructed AssistantMessages.
 */
export function fromOpenAI(
  msg: OAIMessage,
  toolNameById: Map<string, string>,
  template: AssistantTemplate
): Message {
  if (msg.role === 'user') {
    const m = msg as OAIUser;
    if (typeof m.content === 'string') {
      const um: UserMessage = { role: 'user', content: m.content, timestamp: 0 };
      return um;
    }
    // ContentPart[] → pi-ai (TextContent | ImageContent)[]
    const content: (TextContent | ImageContent)[] = (m.content as OAIContentPart[]).map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text } satisfies TextContent;
      }
      // image_url → ImageContent: split "data:<mime>;base64,<data>"
      const url = part.image_url.url;
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match && match[1] !== undefined && match[2] !== undefined) {
        return { type: 'image', mimeType: match[1], data: match[2] } satisfies ImageContent;
      }
      // Non-data-URI image URL: store as a text block with the URL (best effort).
      return { type: 'text', text: url } satisfies TextContent;
    });
    const um: UserMessage = { role: 'user', content, timestamp: 0 };
    return um;
  }

  if (msg.role === 'assistant') {
    const m = msg as OAIAssistant;
    const contentBlocks: (TextContent | ToolCall)[] = [];

    if (m.content !== null) {
      contentBlocks.push({ type: 'text', text: m.content });
    }

    for (const tc of m.tool_calls ?? []) {
      contentBlocks.push({
        type: 'toolCall',
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParse(tc.function.arguments),
      });
    }

    const am: AssistantMessage = {
      role: 'assistant',
      content: contentBlocks,
      api: template.api,
      provider: template.provider,
      model: template.model,
      usage: ZERO_USAGE,
      stopReason: 'stop',
      timestamp: 0,
    };
    return am;
  }

  if (msg.role === 'tool') {
    const m = msg as OAITool;
    const tr: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: m.tool_call_id,
      toolName: toolNameById.get(m.tool_call_id) ?? '',
      content: [{ type: 'text', text: m.content }],
      isError: false,
      timestamp: 0,
    };
    return tr;
  }

  if (msg.role === 'system') {
    // We never forward system messages to headroom; if one appears in the
    // result something is wrong — throw so the service fails open.
    throw new Error('HeadroomCompactor: unexpected system message in headroom output');
  }

  throw new Error(`HeadroomCompactor: unknown OpenAI message role: ${(msg as any).role}`);
}

// ---------------------------------------------------------------------------
// HeadroomCompactor
// ---------------------------------------------------------------------------

export class HeadroomCompactor implements CompactionStrategy {
  readonly name = 'headroom' as const;

  constructor(private readonly compressFn: CompressFn = sdkCompress) {}

  async compact(
    context: Context,
    settings: ResolvedCompactionSettings,
    ctx: CompactionStrategyContext
  ): Promise<Context['messages']> {
    // 1. Build toolCallId → toolName map from original context.
    const toolNameById = new Map<string, string>();
    for (const msg of context.messages) {
      if (msg.role === 'assistant') {
        const am = msg as AssistantMessage;
        for (const block of am.content) {
          if (block.type === 'toolCall') {
            const tc = block as ToolCall;
            toolNameById.set(tc.id, tc.name);
          }
        }
      }
      if (msg.role === 'toolResult') {
        const tr = msg as ToolResultMessage;
        toolNameById.set(tr.toolCallId, tr.toolName);
      }
    }

    // 2. Build assistantTemplate from first AssistantMessage, or use fallback.
    let assistantTemplate: AssistantTemplate = {
      api: 'openai-completions',
      provider: 'openai',
      model: ctx.model,
    };
    for (const msg of context.messages) {
      if (msg.role === 'assistant') {
        const am = msg as AssistantMessage;
        assistantTemplate = { api: am.api, provider: am.provider, model: am.model };
        break;
      }
    }

    // 3. Map pi-ai messages to OpenAI format. systemPrompt is NOT included.
    const openaiMessages = context.messages.map(toOpenAI);

    // 4. Compute tokenBudget.
    let tokenBudget: number | undefined;
    if (ctx.contextLength !== undefined) {
      if (settings.headroom.targetRatio != null) {
        // targetRatio takes precedence when contextLength is known.
        tokenBudget = Math.floor(ctx.contextLength * settings.headroom.targetRatio);
      } else {
        tokenBudget = Math.max(0, ctx.contextLength - 4096);
      }
    }

    // 5. Call compressFn. Errors propagate.
    const result = await this.compressFn(openaiMessages, {
      model: ctx.model,
      baseUrl: settings.headroom.baseUrl,
      apiKey: settings.headroom.apiKey,
      tokenBudget,
      timeout: settings.headroom.timeoutMs,
    });

    // 6. Map result.messages back to pi-ai.
    return result.messages.map((m: OAIMessage) => fromOpenAI(m, toolNameById, assistantTemplate));
  }
}
