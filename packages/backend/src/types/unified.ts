// Unified Message Types

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

// Unified Tool Types

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

// Unified Request

export interface UnifiedChatRequest {
  requestId?: string;
  messages: UnifiedMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
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
  incomingApiType?: string;
  originalBody?: any;
  metadata?: {
    [key: string]: any;
  };
}

// Unified Response

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
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    cache_creation_tokens: number;
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
