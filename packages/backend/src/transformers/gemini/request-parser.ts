import { Content } from '@google/genai';
import { MessageContent, UnifiedChatRequest, UnifiedMessage } from '../../types/unified';
import { convertGeminiPartsToUnified } from './part-mapper';
import { logger } from '../../utils/logger';
import { isValidThoughtSignature } from './utils';

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
      json_schema: generationConfig.responseJsonSchema,
    };
  }

  // Map thinking config
  if (generationConfig.thinkingConfig) {
    unifiedChatRequest.reasoning = {
      enabled: generationConfig.thinkingConfig.includeThoughts,
      max_tokens: generationConfig.thinkingConfig.thinkingBudget,
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
            message.tool_calls.push({
              id: part.functionCall.name || 'call_' + Math.random().toString(36).substring(7),
              type: 'function',
              function: {
                name: part.functionCall.name || 'unknown',
                arguments: JSON.stringify(part.functionCall.args),
              },
            });
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

  return unifiedChatRequest;
}
