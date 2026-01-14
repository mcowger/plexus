export interface TextContent {
  type: "text";
  text: string;
  cache_control?: {
    type?: string;
  };
}

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
  media_type?: string;
}

export type MessageContent = TextContent | ImageContent;

export interface UnifiedMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null | MessageContent[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string; // Often used in 'tool' role messages or 'user' name
  cache_control?: {
    type?: string;
  };
  thinking?: {
    content: string;
    signature?: string;
  };
}

export interface UnifiedTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
      additionalProperties?: boolean;
      $schema?: string;
    };
  };
}

export type ThinkLevel = "none" | "low" | "medium" | "high";

export interface UnifiedChatRequest {
  requestId?: string;
  messages: UnifiedMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: UnifiedTool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | string
    | { type: "function"; function: { name: string } };
  reasoning?: {
    effort?: ThinkLevel;
    max_tokens?: number;
    enabled?: boolean;
  };
  response_format?: {
    type: "text" | "json_object" | "json_schema";
    json_schema?: any;
  };
  n?: number;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  user?: string;
  incomingApiType?: string;
  originalBody?: any;
  metadata?: {
    oauth_project_id?: string;
    [key: string]: any;
  };
}

export interface Annotation {
  type: "url_citation";
  url_citation?: {
    url: string;
    title: string;
    content: string;
    start_index: number;
    end_index: number;
  };
}

export interface UnifiedUsage {
    /**
     * Intended to track the total amount of tokens the user sent, regardless of cache hits.
     */
    input_tokens: number;
    /**
     * intended to represent the number of tokens in the substantive response to the user.   Thus this should EXCLUDE reasoning tokens.
     */
    output_tokens: number;
    /**
     * Intended to represent the total of ALL tokens involved in the interaction - reasoning, output, input, cache hits, etc.
     */
    total_tokens: number;
    /**
     * intended to represent the number of tokens used for tool calls.  This is not commonly exposed.
     */
    tool_use_tokens?: number;
    /**
     * intended to represent the number of tokens used by the model to perform thinking or reasoning.
     */
    reasoning_tokens?: number;
    /**
     * intended to represent the number of tokens from the input that the model was able to retrieve from cache.  Consider as a strict subset of input_tokens
     */
    cache_read_tokens?: number;
    /**
     * intended to represent the number of tokens that were written into cache in this turn.  This is not commonly exposed.
     */
    cache_creation_tokens?: number;
}

export interface UnifiedChatResponse {
  id: string;
  model: string;
  created?: number;
  content: string | null;
  plexus?: {
      provider?: string;
      model?: string;
      apiType?: string;
      pricing?: any;
      providerDiscount?: number;
      canonicalModel?: string;
  };
  reasoning_content?: string | null;
  thinking?: {
    content: string;
    signature?: string;
  };
  usage?: UnifiedUsage;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  annotations?: Annotation[];
  stream?: ReadableStream | any;
  bypassTransformation?: boolean;
  rawResponse?: any;
  rawStream?: ReadableStream;
}

export interface UnifiedChatStreamChunk {
    id: string;
    model: string;
    created: number;
    delta: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
            index?: number; // Stream chunks often have index for tool calls
            id?: string;
            type?: "function";
            function?: {
                name?: string;
                arguments?: string;
            }
        }>;
        reasoning_content?: string | null;
        thinking?: {
            content?: string;
            signature?: string;
        };
    };
    finish_reason?: string | null;
    usage?: UnifiedUsage;
}

export interface StreamTransformOptions {
  debugLogger?: any;
  requestId?: string;
}

export interface ReconstructedChatResponse {
  id: string;
  model: string;
  object: string;
  created: number;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: any;
}

export interface AnthropicContentBlock {
  type: "text" | "thinking" | "tool_use";
  text?: string;
  thinking?: string;
  id?: string; // for tool_use
  name?: string;
  input?: any;
}

export interface ReconstructedMessagesResponse {
  id: string;
  type: "message";
  role: string;
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface Transformer {
  name: string;
  defaultEndpoint: string;
  getEndpoint(request: UnifiedChatRequest): string;
  parseRequest(input: any): Promise<UnifiedChatRequest>;
  transformRequest(request: UnifiedChatRequest): Promise<any>;
  transformResponse(response: any): Promise<UnifiedChatResponse>;
  formatResponse(response: UnifiedChatResponse): Promise<any>;
  parseUsage(input: any): UnifiedUsage;
  formatUsage(usage: UnifiedUsage): any;
  transformStream?(stream: ReadableStream, options?: StreamTransformOptions): ReadableStream;
  formatStream?(stream: ReadableStream, options?: StreamTransformOptions): ReadableStream;
  reconstructResponseFromStream?(rawSSE: string): ReconstructedChatResponse | ReconstructedMessagesResponse | null;
}
