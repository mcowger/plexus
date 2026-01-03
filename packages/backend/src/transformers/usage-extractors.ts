/**
 * Shared utilities for extracting usage data from SSE chunks
 */

/**
 * Parse SSE chunk and extract data lines
 */
export function parseSSEChunk(chunk: Uint8Array | string): string[] {
  const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
  const lines = text.split('\n');
  const dataLines: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    
    const dataStr = trimmed.slice(5).trim();
    if (dataStr && dataStr !== '[DONE]') {
      dataLines.push(dataStr);
    }
  }
  
  return dataLines;
}

/**
 * Extract usage from OpenAI-style SSE chunk
 */
export function extractOpenAIUsage(chunk: Uint8Array | string): {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
} | undefined {
  const dataLines = parseSSEChunk(chunk);
  
  for (const dataStr of dataLines) {
    try {
      const data = JSON.parse(dataStr);
      if (data.usage) {
        return {
          input_tokens: data.usage.prompt_tokens || 0,
          output_tokens: data.usage.completion_tokens || 0,
          cached_tokens: data.usage.prompt_tokens_details?.cached_tokens || 0,
          reasoning_tokens: data.usage.completion_tokens_details?.reasoning_tokens || 0
        };
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  return undefined;
}

/**
 * Extract usage from Anthropic-style SSE chunk
 */
export function extractAnthropicUsage(chunk: Uint8Array | string): {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
} | undefined {
  const dataLines = parseSSEChunk(chunk);
  
  for (const dataStr of dataLines) {
    try {
      const data = JSON.parse(dataStr);
      
      // Anthropic sends usage in message_start and message_delta events
      if (data.type === 'message_start' && data.message?.usage) {
        return {
          input_tokens: data.message.usage.input_tokens || 0,
          output_tokens: data.message.usage.output_tokens || 0,
          cached_tokens: data.message.usage.cache_read_input_tokens || data.message.usage.cache_creation_input_tokens || 0,
          reasoning_tokens: 0
        };
      }
      
      if (data.type === 'message_delta' && data.usage) {
        return {
          input_tokens: 0,
          output_tokens: data.usage.output_tokens || 0,
          cached_tokens: 0,
          reasoning_tokens: 0
        };
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  return undefined;
}

/**
 * Extract usage from Gemini-style SSE chunk
 */
export function extractGeminiUsage(chunk: Uint8Array | string): {
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
} | undefined {
  const dataLines = parseSSEChunk(chunk);
  
  for (const dataStr of dataLines) {
    try {
      const data = JSON.parse(dataStr);
      
      // Gemini sends usage in usageMetadata
      if (data.usageMetadata) {
        return {
          input_tokens: data.usageMetadata.promptTokenCount || 0,
          output_tokens: data.usageMetadata.candidatesTokenCount || 0,
          cached_tokens: data.usageMetadata.cachedContentTokenCount || 0,
          reasoning_tokens: 0
        };
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  return undefined;
}
