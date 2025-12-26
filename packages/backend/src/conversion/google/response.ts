import { generateId } from '@ai-sdk/provider-utils';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Google Generative AI Response Type Definitions
// ============================================================================

/** Google Generative AI response structure */
export interface GoogleGenerativeAIResponse {
  candidates: Array<{
    content?: {
      parts: Array<GoogleGenerativeAIContentPart>;
      role?: string;
    } | null;
    finishReason?: string | null;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }> | null;
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri: string; title?: string };
      }>;
      groundingSupports?: Array<{
        segment: { startIndex: number; endIndex: number; text: string };
        groundingChunkIndices: number[];
        confidenceScores: number[];
      }>;
    } | null;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    cachedContentTokenCount?: number;
  } | null;
  promptFeedback?: {
    blockReason?: string | null;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }> | null;
  } | null;
}

/** Content part types for Google API */
type GoogleGenerativeAIContentPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  | {
      functionCall: { name: string; args: unknown };
      thoughtSignature?: string;
    }
  | { functionResponse: { name: string; response: unknown } }
  | { executableCode: { code: string } }
  | { codeExecutionResult: { outcome: string; output: string } };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map unified finish reason to Google finish reason.
 */
function mapFinishReason(finishReason: string): string {
  logger.debug(`Mapping finish reason: ${finishReason}`);
  let mappedReason: string;

  switch (finishReason) {
    case 'stop':
      mappedReason = 'STOP';
      break;
    case 'length':
      mappedReason = 'MAX_TOKENS';
      break;
    case 'tool-calls':
      mappedReason = 'FUNCTION_CALL';
      break;
    case 'content-filter':
      mappedReason = 'SAFETY';
      break;
    case 'error':
      mappedReason = 'OTHER';
      break;
    case 'other':
      mappedReason = 'OTHER';
      break;
    default:
      mappedReason = 'OTHER';
      break;
  }

  logger.debug(`Mapped finish reason: ${finishReason} -> ${mappedReason}`);
  return mappedReason;
}

/**
 * Build grounding metadata from sources.
 */
function buildGroundingMetadata(sources: Array<any>): {
  groundingChunks?: Array<{
    web?: { uri: string; title?: string };
  }>;
} | null {
  logger.debug(`Building grounding metadata from ${sources?.length || 0} source(s)`);

  if (!sources || sources.length === 0) {
    logger.debug('No sources provided, returning null grounding metadata');
    return null;
  }

  const groundingChunks: Array<{
    web?: { uri: string; title?: string };
  }> = [];

  for (const source of sources) {
    if (source.sourceType === 'url') {
      groundingChunks.push({
        web: {
          uri: source.url,
          title: source.title,
        },
      });
      logger.debug(`Added grounding chunk for URL: ${source.url}`);
    }
  }

  const result = groundingChunks.length > 0 ? { groundingChunks } : null;
  logger.debug(`Built ${groundingChunks.length} grounding chunk(s), returning ${result ? 'metadata' : 'null'}`);
  return result;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert a GenerateTextResult to Google Generative AI API response format.
 *
 * @param result - GenerateTextResult from AI SDK's generateText()
 * @returns Google Generative AI API response object
 *
 * @example
 * ```typescript
 * const result = await generateText({
 *   model: google('gemini-1.5-pro'),
 *   prompt: 'Hello',
 * });
 *
 * const googleResponse = convertToGoogleGenerativeAIResponse(result);
 * console.log(googleResponse.candidates[0].content);
 * ```
 */
export function convertToGoogleGenerativeAIResponse(
  result: any
): GoogleGenerativeAIResponse {
  logger.info('Starting conversion from GenerateTextResult to Google Generative AI response format');
  logger.debug(`Result has ${result.content?.length || 0} content part(s), finishReason: ${result.finishReason || 'none'}`);

  const parts: Array<GoogleGenerativeAIContentPart> = [];

  // Process content array
  if (result.content && Array.isArray(result.content)) {
    logger.debug(`Processing ${result.content.length} content part(s)`);

    for (let i = 0; i < result.content.length; i++) {
      const part = result.content[i];
      logger.debug(`Processing content part ${i + 1} of type: ${part.type}`);

      if (part.type === 'text') {
        parts.push({
          text: part.text,
          thought: false,
        });
        logger.debug(`Added text part with ${part.text.length} characters`);
      } else if (part.type === 'reasoning') {
        // Check for thought signature in provider metadata
        const thoughtSignature =
          part.providerMetadata?.google?.thoughtSignature ||
          part.providerMetadata?.google?.signature ||
          '';

        parts.push({
          text: part.text,
          thought: true,
          thoughtSignature: thoughtSignature || undefined,
        });
        logger.debug(`Added reasoning part with ${part.text.length} characters, has signature: ${!!thoughtSignature}`);
      } else if (part.type === 'tool-call') {
        // Parse input if it's a string, otherwise use as-is
        let args: unknown;
        if (typeof part.input === 'string') {
          try {
            args = JSON.parse(part.input);
            logger.debug(`Successfully parsed tool call arguments as JSON for '${part.toolName}'`);
          } catch {
            args = part.input;
            logger.debug(`Failed to parse tool call arguments as JSON for '${part.toolName}', using raw value`);
          }
        } else {
          args = part.input || {};
          logger.debug(`Using object directly as tool call arguments for '${part.toolName}'`);
        }

        const functionCallPart: any = {
          functionCall: {
            name: part.toolName,
            args,
          },
        };

        // Add thought signature if available
        const thoughtSignature =
          part.providerMetadata?.google?.thoughtSignature;
        if (thoughtSignature) {
          functionCallPart.thoughtSignature = thoughtSignature;
          logger.debug(`Added thought signature to function call`);
        }

        parts.push(functionCallPart);
        logger.debug(`Added function call part for '${part.toolName}'`);
      } else if (part.type === 'file') {
        // Convert file to inlineData format
        const file = part.file;
        if (file && file.data) {
          // If data is a string (base64), use it directly
          if (typeof file.data === 'string') {
            parts.push({
              inlineData: {
                mimeType: file.mimeType || 'application/octet-stream',
                data: file.data,
              },
            });
            logger.debug(`Converted file to inlineData with mime type: ${file.mimeType || 'application/octet-stream'}`);
          }
          // If data is a URL, use fileData format
          else if (file.data instanceof URL || typeof file.data === 'object') {
            const url =
              file.data instanceof URL ? file.data.toString() : String(file.data);
            parts.push({
              fileData: {
                mimeType: file.mimeType || 'application/octet-stream',
                fileUri: url,
              },
            });
            logger.debug(`Converted file to fileData with mime type: ${file.mimeType || 'application/octet-stream'}, URI: ${url}`);
          }
        } else {
          logger.warn('File part found but no file data available');
        }
      }
      // Ignore: tool-result, source (handled via grounding metadata)
    }
  } else {
    logger.debug('No content array found in result');
  }

  // If no parts were created, add an empty text part
  if (parts.length === 0) {
    logger.debug('No parts created, adding empty text part');
    parts.push({
      text: '',
      thought: false,
    });
  }

  // Build grounding metadata from sources
  const groundingMetadata = buildGroundingMetadata(result.sources || []);
  if (groundingMetadata?.groundingChunks) {
    logger.debug(`Built grounding metadata with ${groundingMetadata.groundingChunks.length} chunk(s)`);
  }

  // Build usage metadata
  const usageMetadata = result.usage
    ? {
        promptTokenCount: result.usage.inputTokens || 0,
        candidatesTokenCount: result.usage.outputTokens || 0,
        totalTokenCount: result.usage.totalTokens || 0,
        cachedContentTokenCount:
          result.usage.inputTokenDetails?.cacheReadTokens,
      }
    : null;

  if (usageMetadata) {
    logger.debug(`Built usage metadata: prompt=${usageMetadata.promptTokenCount}, candidates=${usageMetadata.candidatesTokenCount}, total=${usageMetadata.totalTokenCount}`);
  }

  // Build response
  const response: GoogleGenerativeAIResponse = {
    candidates: [
      {
        content: {
          parts,
          role: 'model',
        },
        finishReason: mapFinishReason(result.finishReason || 'stop'),
        safetyRatings: null,
        groundingMetadata,
      },
    ],
    usageMetadata,
    promptFeedback: null,
  };

  logger.info(`Conversion completed successfully. Generated ${parts.length} part(s)`);
  return response;
}
