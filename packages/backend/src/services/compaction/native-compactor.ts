import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';
import type {
  CompactionStrategy,
  CompactionStrategyContext,
  ResolvedCompactionSettings,
} from './types';

/** Recursively compact a JSON value. Never mutates the input. */
function compactJsonValue(value: unknown, maxArrayItems: number): unknown {
  if (Array.isArray(value)) {
    if (value.length > maxArrayItems) {
      const compacted = value
        .slice(0, maxArrayItems)
        .map((v) => compactJsonValue(v, maxArrayItems));
      compacted.push(`…[${value.length - maxArrayItems} items omitted]`);
      return compacted;
    }
    return value.map((v) => compactJsonValue(v, maxArrayItems));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = compactJsonValue(v, maxArrayItems);
    }
    return result;
  }
  // primitives: string, number, boolean, null
  return value;
}

/** Compact a text string: JSON-compact if parseable, else truncate if too long. */
function compactText(text: string, maxArrayItems: number, maxStringChars: number): string {
  // 1. Try to parse as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    return JSON.stringify(compactJsonValue(parsed, maxArrayItems));
  }

  // 2. Truncate if too long
  if (text.length > maxStringChars) {
    const excess = text.length - maxStringChars;
    return `${text.slice(0, maxStringChars)}…[truncated ${excess} chars]`;
  }

  // 3. Return unchanged
  return text;
}

function compactUserMessage(
  msg: UserMessage,
  maxArrayItems: number,
  maxStringChars: number
): UserMessage {
  if (typeof msg.content === 'string') {
    const compacted = compactText(msg.content, maxArrayItems, maxStringChars);
    if (compacted === msg.content) return msg;
    return { ...msg, content: compacted };
  }

  // content is (TextContent | ImageContent)[]
  const newBlocks = (msg.content as (TextContent | ImageContent)[]).map(
    (block): TextContent | ImageContent => {
      if (block.type === 'text') {
        const newText = compactText(block.text, maxArrayItems, maxStringChars);
        if (newText === block.text) return block;
        return { ...block, text: newText };
      }
      // image — pass through
      return block;
    }
  );

  // check if anything actually changed
  const changed = newBlocks.some(
    (b, i) => b !== (msg.content as Array<TextContent | ImageContent>)[i]
  );
  if (!changed) return msg;
  return { ...msg, content: newBlocks };
}

function compactAssistantMessage(
  msg: AssistantMessage,
  maxArrayItems: number,
  maxStringChars: number
): AssistantMessage {
  const newBlocks = (msg.content as (TextContent | ThinkingContent | ToolCall)[]).map(
    (block): TextContent | ThinkingContent | ToolCall => {
      if (block.type === 'text') {
        const newText = compactText(block.text, maxArrayItems, maxStringChars);
        if (newText === block.text) return block;
        return { ...block, text: newText };
      }
      if (block.type === 'toolCall') {
        const newArgs = compactJsonValue(block.arguments, maxArrayItems) as Record<string, unknown>;
        // compactJsonValue always returns a new object for object inputs, but
        // if no items were truncated the values are reference-equal; we still
        // replace so the result is always a fresh object (no mutation guarantee).
        return { ...block, arguments: newArgs };
      }
      // thinking or unknown — pass through
      return block;
    }
  );

  const changed = newBlocks.some(
    (b, i) => b !== (msg.content as Array<TextContent | ThinkingContent | ToolCall>)[i]
  );
  if (!changed) return msg;
  return { ...msg, content: newBlocks };
}

function compactToolResultMessage(
  msg: ToolResultMessage,
  maxArrayItems: number,
  maxStringChars: number
): ToolResultMessage {
  const newBlocks = (msg.content as (TextContent | ImageContent)[]).map(
    (block): TextContent | ImageContent => {
      if (block.type === 'text') {
        const newText = compactText(block.text, maxArrayItems, maxStringChars);
        if (newText === block.text) return block;
        return { ...block, text: newText };
      }
      return block;
    }
  );

  const changed = newBlocks.some(
    (b, i) => b !== (msg.content as Array<TextContent | ImageContent>)[i]
  );
  if (!changed) return msg;
  return { ...msg, content: newBlocks };
}

export class NativeCompactor implements CompactionStrategy {
  readonly name = 'native' as const;

  async compact(
    context: Context,
    settings: ResolvedCompactionSettings,
    _ctx: CompactionStrategyContext
  ): Promise<Context['messages']> {
    const messages = context.messages;
    const { protectRecent } = settings;
    const { maxArrayItems, maxStringChars } = settings.native;

    const cutoff = Math.max(0, messages.length - protectRecent);
    const toCompact = messages.slice(0, cutoff);
    const protected_ = messages.slice(cutoff);

    const compacted = toCompact.map((msg) => {
      if (msg.role === 'user') {
        return compactUserMessage(msg as UserMessage, maxArrayItems, maxStringChars);
      }
      if (msg.role === 'assistant') {
        return compactAssistantMessage(msg as AssistantMessage, maxArrayItems, maxStringChars);
      }
      if (msg.role === 'toolResult') {
        return compactToolResultMessage(msg as ToolResultMessage, maxArrayItems, maxStringChars);
      }
      // unknown role — pass through unchanged
      return msg;
    });

    return [...compacted, ...protected_];
  }
}
