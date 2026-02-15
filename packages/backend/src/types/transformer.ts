import { UnifiedChatRequest, UnifiedChatResponse } from './unified';

export interface Transformer {
  // Name of the API type (e.g. 'OpenAI', 'Anthropic')
  readonly name: string;

  // Endpoint suffix (e.g. '/chat/completions', '/messages')
  readonly defaultEndpoint: string;

  // Dynamically resolve endpoint if it depends on request parameters (like model in Gemini)
  getEndpoint?(request: UnifiedChatRequest): string;

  // Convert Client Request (in this format) to Unified Request
  parseRequest(input: any): Promise<UnifiedChatRequest>;

  // Convert Unified Request to Provider Request (in this format)
  transformRequest(request: UnifiedChatRequest): Promise<any>;

  // Convert Provider Response (in this format) to Unified Response
  transformResponse(response: any): Promise<UnifiedChatResponse>;

  // Convert Unified Response to Client Response (in this format)
  formatResponse(response: UnifiedChatResponse): Promise<any>;

  // Convert Provider Stream to Unified Stream
  // Takes a raw stream from provider, returns a stream of UnifiedChatStreamChunk
  transformStream?(stream: ReadableStream | AsyncIterable<any>): ReadableStream;

  // Convert Unified Stream to Client Stream
  // Takes a stream of UnifiedChatStreamChunk, returns a raw stream for the client
  formatStream?(stream: ReadableStream): ReadableStream;

  // Extract usage information from SSE event data (JSON string)
  // Used by the observer to parse usage data from complete SSE events
  // Returns undefined if no usage data is present in this event
  extractUsage(eventData: string): { 
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cache_creation_tokens?: number;
    reasoning_tokens?: number;
  } | undefined;
}
