// ============================================================================
// OpenAI Responses API Types
// Based on: https://platform.openai.com/docs/api-reference/responses
// ============================================================================

// ============================================================================
// Input Types
// ============================================================================

export interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  id?: string;
}

export interface ResponsesMessageItem extends ResponsesInputItem {
  type: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: ResponsesContentPart[];
  status?: 'in_progress' | 'completed' | 'incomplete';
}

export type ResponsesContentPart = 
  | ResponsesInputTextPart 
  | ResponsesInputImagePart 
  | ResponsesInputAudioPart
  | ResponsesOutputTextPart
  | ResponsesSummaryTextPart;

export interface ResponsesInputTextPart {
  type: 'input_text';
  text: string;
}

export interface ResponsesInputImagePart {
  type: 'input_image';
  image_url: string;
  detail?: 'low' | 'high' | 'auto';
}

export interface ResponsesInputAudioPart {
  type: 'input_audio';
  audio_url: string;
  transcript?: string;
}

export interface ResponsesOutputTextPart {
  type: 'output_text';
  text: string;
  annotations?: Annotation[];
  logprobs?: any[];
}

export interface ResponsesSummaryTextPart {
  type: 'summary_text';
  text: string;
}

export interface ResponsesFunctionCallItem extends ResponsesInputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  status?: 'in_progress' | 'completed' | 'failed';
}

export interface ResponsesFunctionCallOutputItem extends ResponsesInputItem {
  type: 'function_call_output';
  call_id: string;
  output: any;
  status?: 'completed' | 'failed';
}

export interface ResponsesReasoningItem extends ResponsesInputItem {
  type: 'reasoning';
  summary: ResponsesSummaryTextPart[];
  reasoning_content?: ResponsesContentPart[];
  encrypted_content?: string;
  status?: 'in_progress' | 'completed';
}

export interface Annotation {
  type: string;
  text?: string;
  start_index?: number;
  end_index?: number;
  url_citation?: {
    url: string;
    title?: string;
  };
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: any; // JSON Schema
  strict?: boolean;
}

export interface ResponsesWebSearchTool {
  type: 'web_search';
}

export interface ResponsesFileSearchTool {
  type: 'file_search';
  vector_store_ids: string[];
}

export interface ResponsesCodeInterpreterTool {
  type: 'code_interpreter';
}

export interface ResponsesComputerUseTool {
  type: 'computer_use';
}

export interface ResponsesImageGenerationTool {
  type: 'image_generation';
  model?: string;
  size?: string;
  quality?: 'standard' | 'hd';
  output_format?: 'png' | 'jpeg' | 'webp';
  background?: 'opaque' | 'transparent';
  output_compression?: number;
  input_fidelity?: string;
  partial_images?: number;
  moderation?: 'auto' | 'none';
}

export interface ResponsesMCPTool {
  type: 'mcp';
  server_label: string;
  server_description: string;
  server_url: string;
  require_approval?: 'never' | 'always' | 'once';
}

export type ResponsesTool = 
  | ResponsesFunctionTool 
  | ResponsesWebSearchTool 
  | ResponsesFileSearchTool 
  | ResponsesCodeInterpreterTool
  | ResponsesComputerUseTool
  | ResponsesImageGenerationTool
  | ResponsesMCPTool;

// ============================================================================
// Request Type
// ============================================================================

export interface UnifiedResponsesRequest {
  requestId?: string;
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: 'none' | 'auto' | 'required' | {
    mode: 'required' | 'auto';
    type: string;
    name: string;
  };
  parallel_tool_calls?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  max_tool_calls?: number;
  top_logprobs?: number;
  text?: {
    format?: {
      type: 'text' | 'json_object' | 'json_schema';
      name?: string;
      schema?: any;
    };
    verbosity?: 'low' | 'medium' | 'high';
  };
  reasoning?: {
    effort?: 'low' | 'medium' | 'high' | 'minimal' | 'xhigh';
    summary?: 'auto' | 'concise' | 'detailed';
    max_tokens?: number;
  };
  stream?: boolean;
  stream_options?: {
    include_obfuscation?: boolean;
  };
  store?: boolean;
  background?: boolean;
  previous_response_id?: string;
  conversation?: string | {
    id: string;
    [key: string]: any;
  };
  include?: string[];
  metadata?: Record<string, string>;
  safety_identifier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  service_tier?: 'auto' | 'default' | 'flex' | 'priority';
  truncation?: 'auto' | 'disabled';
  
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
}

// ============================================================================
// Response Type
// ============================================================================

export interface UnifiedResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  completed_at?: number;
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  model: string;
  output: ResponsesOutputItem[];
  instructions?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  top_logprobs?: number;
  parallel_tool_calls?: boolean;
  tool_choice?: any;
  tools?: ResponsesTool[];
  text?: any;
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  usage?: {
    input_tokens: number;
    input_tokens_details?: {
      cached_tokens: number;
    };
    output_tokens: number;
    output_tokens_details?: {
      reasoning_tokens: number;
    };
    total_tokens: number;
  };
  previous_response_id?: string;
  conversation?: any;
  store?: boolean;
  background?: boolean;
  truncation?: string;
  incomplete_details?: {
    reason: 'max_output_tokens' | 'content_filter';
  };
  error?: {
    message: string;
    type: string;
    code?: string;
    param?: string;
  };
  safety_identifier?: string;
  service_tier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  metadata?: Record<string, string>;
  
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
  
  // Internal
  rawResponse?: any;
  stream?: ReadableStream;
  bypassTransformation?: boolean;
}

export type ResponsesOutputItem = 
  | ResponsesMessageItem 
  | ResponsesFunctionCallItem 
  | ResponsesFunctionCallOutputItem 
  | ResponsesReasoningItem
  | ResponsesBuiltInToolCallItem;

export interface ResponsesBuiltInToolCallItem {
  type: 'web_search_call' | 'file_search_call' | 'code_interpreter_call' | 'computer_call' | 'image_generation_call' | 'mcp_call';
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  [key: string]: any; // Tool-specific fields
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface ResponsesStreamEvent {
  type: string;
  sequence_number: number;
  [key: string]: any;
}

export interface ResponsesCreatedEvent extends ResponsesStreamEvent {
  type: 'response.created';
  response: Partial<UnifiedResponsesResponse>;
}

export interface ResponsesInProgressEvent extends ResponsesStreamEvent {
  type: 'response.in_progress';
  response: Partial<UnifiedResponsesResponse>;
}

export interface ResponsesOutputItemAddedEvent extends ResponsesStreamEvent {
  type: 'response.output_item.added';
  output_index: number;
  item: Partial<ResponsesOutputItem>;
}

export interface ResponsesOutputItemDoneEvent extends ResponsesStreamEvent {
  type: 'response.output_item.done';
  output_index: number;
  item: Partial<ResponsesOutputItem>;
}

export interface ResponsesContentPartAddedEvent extends ResponsesStreamEvent {
  type: 'response.content_part.added';
  item_id: string;
  output_index: number;
  content_index: number;
  part: { type: string };
}

export interface ResponsesContentPartDoneEvent extends ResponsesStreamEvent {
  type: 'response.content_part.done';
  item_id: string;
  output_index: number;
  content_index: number;
  part: any;
}

export interface ResponsesOutputTextDeltaEvent extends ResponsesStreamEvent {
  type: 'response.output_text.delta';
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponsesOutputTextDoneEvent extends ResponsesStreamEvent {
  type: 'response.output_text.done';
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponsesFunctionCallArgumentsDeltaEvent extends ResponsesStreamEvent {
  type: 'response.function_call_arguments.delta';
  item_id: string;
  output_index: number;
  delta: string;
}

export interface ResponsesFunctionCallArgumentsDoneEvent extends ResponsesStreamEvent {
  type: 'response.function_call_arguments.done';
  item_id: string;
  output_index: number;
  name: string;
  arguments: string;
}

export interface ResponsesReasoningSummaryTextDeltaEvent extends ResponsesStreamEvent {
  type: 'response.reasoning_summary_text.delta';
  item_id: string;
  output_index: number;
  delta: string;
}

export interface ResponsesReasoningSummaryTextDoneEvent extends ResponsesStreamEvent {
  type: 'response.reasoning_summary_text.done';
  item_id: string;
  output_index: number;
  text: string;
}

export interface ResponsesCompletedEvent extends ResponsesStreamEvent {
  type: 'response.completed';
  response: UnifiedResponsesResponse;
}

export interface ResponsesFailedEvent extends ResponsesStreamEvent {
  type: 'response.failed';
  response: Partial<UnifiedResponsesResponse>;
  error: any;
}

export interface ResponsesIncompleteEvent extends ResponsesStreamEvent {
  type: 'response.incomplete';
  response: Partial<UnifiedResponsesResponse>;
}
