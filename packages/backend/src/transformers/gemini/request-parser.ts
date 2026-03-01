import { Content } from '@google/genai';
import { MessageContent, UnifiedChatRequest, UnifiedMessage } from '../../types/unified';
import { convertGeminiPartsToUnified } from './part-mapper';
import { logger } from '../../utils/logger';
import { isValidThoughtSignature, normalizeJsonSchemaTypes } from './utils';

/**
 * Parses a Gemini API request and converts it to unified format.
 *
 * Key transformations:
 * - Contents array parsing (role mapping: model → assistant)
 * - Part-based content system (text, inlineData, functionCall, functionResponse)
 * - Generation config mapping (maxOutputTokens, temperature, thinkingConfig)
 * - Tool handling
 */
export async function parseGeminiRequest(input: any): Promise<UnifiedChatRequest> {
  const contents: Content[] = input.contents || [];
  const tools: any[] = input.tools || [];
  const model: string = input.model || '';
  const generationConfig = input.generationConfig || {};
  const systemInstruction = input.systemInstruction as Content | undefined;

  const unifiedChatRequest: UnifiedChatRequest = {
    messages: [],
    model,
    max_tokens: generationConfig.maxOutputTokens,
    temperature: generationConfig.temperature,
    stream: false,
    tool_choice: undefined,
  };

  if (input.stream) {
    unifiedChatRequest.stream = true;
  }

  // Handle Gap 1: systemInstruction (inbound)
  if (systemInstruction && systemInstruction.parts) {
    const onThinking = (text: string, signature?: string) => {
      // systemInstruction typically doesn't contain thinking, but handle it anyway
    };

    const contentParts = convertGeminiPartsToUnified(systemInstruction.parts, onThinking);

    // Simplify content structure if it's just text
    let content: string | MessageContent[] = [];
    const firstPart = contentParts[0];
    if (contentParts.length === 1 && firstPart?.type === 'text') {
      content = firstPart.text;
    } else if (contentParts.length > 0) {
      content = contentParts;
    }

    unifiedChatRequest.systemInstruction = {
      role: 'system',
      content,
    };
  }

  // Map response format
  if (generationConfig.responseMimeType === 'application/json') {
    unifiedChatRequest.response_format = {
      type: generationConfig.responseJsonSchema ? 'json_schema' : 'json_object',
      json_schema: generationConfig.responseJsonSchema
        ? normalizeJsonSchemaTypes(generationConfig.responseJsonSchema)
        : undefined,
    };
  }

  // Map thinking config
  if (generationConfig.thinkingConfig) {
    const thinkingLevel = generationConfig.thinkingConfig.thinkingLevel as string | undefined;
    unifiedChatRequest.reasoning = {
      enabled: generationConfig.thinkingConfig.includeThoughts,
      max_tokens: generationConfig.thinkingConfig.thinkingBudget,
      // Map Gemini's thinkingLevel (NONE/LOW/MEDIUM/HIGH) to unified ThinkLevel
      effort: thinkingLevel ? (thinkingLevel.toLowerCase() as any) : undefined,
    };
  }

  // Gap 3: Map toolConfig (function calling configuration)
  if (input.toolConfig) {
    unifiedChatRequest.toolConfig = {
      mode: input.toolConfig.functionCallingConfig?.mode,
      functionCallingPreference: input.toolConfig.functionCallingConfig?.functionCallingPreference,
    };
  }

  // Gap 4 & 5: Map tools (function declarations and Google built-in tools)
  if (Array.isArray(tools) && tools.length > 0) {
    const unifiedTools: any[] = [];

    for (const tool of tools) {
      // Handle function declarations
      if (tool.functionDeclarations) {
        for (const funcDecl of tool.functionDeclarations) {
          unifiedTools.push({
            type: 'function',
            function: {
              name: funcDecl.name,
              description: funcDecl.description,
              // Gap 4: Prefer parametersJsonSchema if available
              parametersJsonSchema: funcDecl.parametersJsonSchema,
              parameters: funcDecl.parameters,
            },
          });
        }
      }

      // Gap 5: Handle Google built-in tools
      if (tool.googleSearch) {
        unifiedTools.push({ type: 'googleSearch' as const, googleSearch: {} });
      }
      if (tool.codeExecution) {
        unifiedTools.push({ type: 'codeExecution' as const, codeExecution: {} });
      }
      if (tool.urlContext) {
        unifiedTools.push({ type: 'urlContext' as const, urlContext: {} });
      }
    }

    if (unifiedTools.length > 0) {
      unifiedChatRequest.tools = unifiedTools;
    }
  }

  // Map Gemini Contents to Unified Messages
  if (Array.isArray(contents)) {
    contents.forEach((content) => {
      const role = content.role === 'model' ? 'assistant' : 'user';

      if (content.parts) {
        const message: UnifiedMessage = {
          role: role as 'user' | 'assistant' | 'system',
          content: [],
        };

        // Handle thinking/thought parts
        // Gap 6: Validate thought signatures for base64 format
        const onThinking = (text: string, signature?: string) => {
          if (!message.thinking) message.thinking = { content: '' };
          message.thinking.content += text;

          // Validate signature before storing
          if (signature) {
            if (isValidThoughtSignature(signature)) {
              message.thinking.signature = signature;
            } else {
              logger.warn(
                `[gemini] Invalid thought signature detected in request, stripping from message. Signature length: ${signature.length}`
              );
              // Don't assign invalid signature - strip it
            }
          }
        };

        const contentParts = convertGeminiPartsToUnified(content.parts, onThinking);

        // Handle function calls
        content.parts.forEach((part) => {
          if (part.functionCall) {
            if (!message.tool_calls) message.tool_calls = [];
            const toolCall: NonNullable<typeof message.tool_calls>[number] = {
              id: part.functionCall.name || 'call_' + Math.random().toString(36).substring(7),
              type: 'function',
              function: {
                name: part.functionCall.name || 'unknown',
                arguments: JSON.stringify(part.functionCall.args),
              },
            };
            // Preserve thoughtSignature from the functionCall part so it can be
            // replayed correctly to Gemini 3 (which requires it for history context).
            const sig = (part as any).thoughtSignature;
            if (sig) toolCall.thought_signature = sig;
            message.tool_calls.push(toolCall);
          }
        });

        // Simplify content structure if it's just text
        const firstPart = contentParts[0];
        if (contentParts.length === 1 && firstPart?.type === 'text') {
          message.content = firstPart.text;
        } else if (contentParts.length > 0) {
          message.content = contentParts;
        } else {
          message.content = null;
        }

        // Handle Gemini's functionResponse (mapping to 'tool' role)
        const functionResponses = content.parts.filter((p) => p.functionResponse);
        if (functionResponses.length > 0) {
          functionResponses.forEach((fr) => {
            unifiedChatRequest.messages.push({
              role: 'tool',
              content: JSON.stringify(fr.functionResponse?.response),
              tool_call_id: fr.functionResponse?.name || 'unknown_tool',
              name: fr.functionResponse?.name,
            });
          });
          if (contentParts.length > 0) unifiedChatRequest.messages.push(message);
        } else {
          unifiedChatRequest.messages.push(message);
        }
      }
    });
  }

  // Merge consecutive assistant messages into single messages.
  // The Gemini API sends parallel tool calls as separate model-role content objects,
  // but pi-ai (and most LLM providers) expect them combined in one assistant message.
  const merged: UnifiedMessage[] = [];
  for (const msg of unifiedChatRequest.messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === 'assistant' && msg.role === 'assistant') {
      // Merge tool_calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        if (!prev.tool_calls) prev.tool_calls = [];
        prev.tool_calls.push(...msg.tool_calls);
      }
      // Merge content (append text if both have it)
      if (msg.content && prev.content) {
        if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content = prev.content + msg.content;
        } else if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
          prev.content = [...prev.content, ...msg.content];
        }
      } else if (msg.content && !prev.content) {
        prev.content = msg.content;
      }
      // Merge thinking
      if (msg.thinking) {
        if (!prev.thinking) {
          prev.thinking = msg.thinking;
        } else {
          prev.thinking.content = (prev.thinking.content || '') + (msg.thinking.content || '');
          if (msg.thinking.signature) prev.thinking.signature = msg.thinking.signature;
        }
      }
    } else {
      merged.push(msg);
    }
  }

  // Propagate thought signatures within each merged assistant message.
  // Gemini only puts the thoughtSignature on the first functionCall part in a parallel
  // tool-call turn; subsequent calls in the same turn have no signature. Since they all
  // share the same thought context, we forward the first available signature to any
  // unsigned siblings so pi-ai doesn't degrade them to plain text.
  for (const msg of merged) {
    if (msg.role !== 'assistant' || !msg.tool_calls || msg.tool_calls.length < 2) continue;
    const sharedSig = msg.tool_calls.find((tc) => tc.thought_signature)?.thought_signature;
    if (sharedSig) {
      for (const tc of msg.tool_calls) {
        if (!tc.thought_signature) tc.thought_signature = sharedSig;
      }
    }
  }

  unifiedChatRequest.messages = merged;

  return unifiedChatRequest;
}
