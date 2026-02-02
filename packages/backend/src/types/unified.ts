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
      config?: any;
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
  finishReason?: string | null;
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

// Unified Embeddings Request
export interface UnifiedEmbeddingsRequest {
  requestId?: string;
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  dimensions?: number;
  user?: string;
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any>;
}

// Unified Embeddings Response
export interface UnifiedEmbeddingsResponse {
  object: "list";
  data: Array<{
    object: "embedding";
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}

// Unified Transcription Request
export interface UnifiedTranscriptionRequest {
  requestId?: string;
  file: Buffer;
  filename: string;
  mimeType: string;
  model: string;
  
  // Optional parameters
  language?: string;
  prompt?: string;
  response_format?: 'json' | 'text';  // Only json and text for v1
  temperature?: number;
  
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
}

// Unified Transcription Response
export interface UnifiedTranscriptionResponse {
  text: string;

  // Optional usage field (present in JSON response)
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };

  // Plexus metadata
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };

  rawResponse?: any;
}

// Unified Speech Request
export interface UnifiedSpeechRequest {
  requestId?: string;
  model: string;
  input: string;
  voice: string;
  instructions?: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  speed?: number;
  stream_format?: 'sse' | 'audio';
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any>;
}

// Unified Speech Response
export interface UnifiedSpeechResponse {
  audio?: Buffer;
  stream?: ReadableStream;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
  isStreamed?: boolean;
}

// Unified Image Generation Request
export interface UnifiedImageGenerationRequest {
  requestId?: string;
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
  quality?: string;
  style?: string;
  user?: string;
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any>;
}

// Unified Image Generation Response
export interface UnifiedImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}

// Unified Image Edit Request
export interface UnifiedImageEditRequest {
  requestId?: string;
  model: string;
  prompt: string;
  image: Buffer;
  filename: string;
  mimeType: string;
  mask?: Buffer;
  maskFilename?: string;
  maskMimeType?: string;
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
  quality?: string;
  user?: string;
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any>;
}

// Unified Image Edit Response
export interface UnifiedImageEditResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}
