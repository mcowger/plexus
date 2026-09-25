// Unified Message Types
import type { DecisionsAnswer, DecisionsQuestion } from './decisions';

export interface TextContent {
  type: 'text';
  text: string;
  cache_control?: {
    type?: string;
  };
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
  media_type?: string;
  cache_control?: {
    type?: string;
  };
}

export type MessageContent = TextContent | ImageContent;

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null | MessageContent[];
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
    thought_signature?: string;
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
  thought_signature?: string; // New field for direct mapping
}

// Unified Tool Types

export type GoogleBuiltInToolType = 'googleSearch' | 'codeExecution' | 'urlContext';

export interface UnifiedToolFunction {
  name: string;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
    $schema?: string;
  };
  parametersJsonSchema?: any; // Newer format supporting full JSON Schema (anyOf, oneOf, const)
  strict?: boolean;
}

export interface UnifiedTool {
  type: 'function' | GoogleBuiltInToolType;
  function?: UnifiedToolFunction;
  // Google built-in tools don't have function declarations
  googleSearch?: Record<string, never>;
  codeExecution?: Record<string, never>;
  urlContext?: Record<string, never>;
}

// Tool Configuration (for Gemini's toolConfig)
export interface UnifiedToolConfig {
  mode?: 'auto' | 'none' | 'any';
  functionCallingPreference?: string;
}

export type ThinkLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface KeyAccessPolicy {
  allowedModels?: string[];
  allowedProviders?: string[];
  excludedModels?: string[];
  excludedProviders?: string[];
}

// Unified Request

export interface PlexusMetadata {
  oauthProvider?: string;
  oauthAccount?: string;
  clientHeaders?: Record<string, unknown>;
  plexus_key_policy?: KeyAccessPolicy;
  /** Attached by attachQuotaContext() (quota-middleware.ts) after the
   * per-request quota check — read by Dispatcher.applyQuotaFilter() to
   * narrow candidates around exhausted scoped quotas. `QuotaContext` type
   * import kept here rather than duplicated; quota-enforcer.ts has no
   * dependency back on this module. */
  plexus_quota_context?: import('../services/quota/quota-enforcer').QuotaContext;
}

export interface UnifiedChatRequest {
  requestId?: string;
  /**
   * Set by the Responses API route when the client supplied
   * `previous_response_id`. Used by sticky-session routing to chain turns
   * without hashing message content.
   */
  previousResponseId?: string;
  messages: UnifiedMessage[];
  model: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: UnifiedTool[];
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | string
    | { type: 'function'; function: { name: string } };
  toolConfig?: UnifiedToolConfig; // Gemini's toolConfig (function calling configuration)
  reasoning?: {
    effort?: ThinkLevel;
    max_tokens?: number;
    enabled?: boolean;
    adaptive?: boolean;
    summary?: string;
  };
  include?: string[];
  prompt_cache_key?: string;
  systemInstruction?: UnifiedMessage; // Gemini's systemInstruction field
  text?: {
    verbosity?: string;
    format?: {
      type: string;
      schema?: any;
    };
  };
  parallel_tool_calls?: boolean;
  response_format?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: any;
    /**
     * Structured-output descriptor fields carried from the client (Responses
     * `text.format.name` / `description` / `strict`) so cross-format
     * emission preserves the client-supplied values — fabricated fallbacks
     * (`response_schema`, `strict: true`) apply only when these are absent.
     */
    name?: string;
    description?: string;
    strict?: boolean;
  };
  prompt?: string | string[];
  suffix?: string | null;
  echo?: boolean;
  logprobs?: number | null;
  best_of?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  user?: string;
  cacheRoutingHeaders?: CacheRoutingHeaders;
  anthropicBeta?: string;
  /** Inbound `user-agent` header (captured by the inference routes). */
  userAgent?: string;
  /** Inbound `x-claude-code-session-id` header (Claude Code clients). */
  claudeCodeSessionId?: string;
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

export interface CacheRoutingHeaders {
  session_id?: string;
  'x-client-request-id'?: string;
  'x-session-affinity'?: string;
  'x-session-id'?: string;
  'x-prompt-cache-isolation-key'?: string;
  'x-multi-turn-session-id'?: string;
  'x-opencode-session'?: string;
}

// Unified Response

export interface Annotation {
  type: 'url_citation';
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
  /**
   * Image-token breakdowns reported by providers that bill images separately
   * (OpenAI Responses `*_tokens_details.image_tokens`, emitted when the
   * built-in `image_generation` tool runs). Left UNDEFINED when the provider
   * reports no such detail so downstream payloads stay byte-identical —
   * `undefined` means "not reported", which is distinct from a reported 0.
   */
  input_image_tokens?: number;
  output_image_tokens?: number;
}

/**
 * A COMPLETED Responses-API `image_generation_call` output item carried typed
 * through the unified layer (mirroring how tool_calls are carried) so
 * same-format (responses -> responses) non-bypass routes can re-emit the
 * native item instead of a lossy markdown rendering. The typed item always
 * carries the full base64 `result`, never size-capped.
 *
 * UNARY: transformResponse carries images typed ONLY — unified `content`
 * stays pure authored text, and chat/messages-facing formatters compose the
 * size-guarded markdown projection themselves from this field (see
 * transformers/image-rendering.ts) while responses-facing formatters re-emit
 * the native item with no string surgery.
 *
 * STREAMING: transformStream pairs the typed chunk-level carry with the
 * chat-format markdown rendering on the SAME chunk's `delta.content`;
 * responses-facing formatStream re-emits the native item and structurally
 * skips that paired content delta (keyed on the typed items being present on
 * the chunk — never on string matching).
 */
export interface UnifiedImageGenerationCall {
  id?: string;
  status?: string;
  /** Base64 image payload, byte-intact (no inline-size cap at this layer). */
  result: string;
}

/**
 * A Responses-API built-in tool-call output item whose execution is deferred
 * to the CLIENT (`execution: "client"`, e.g. `tool_search_call`) — the model
 * expects the caller to run the call and continue the turn, mirroring how a
 * `function_call` works. Carried through the unified layer typed and
 * untouched (same pattern as UnifiedImageGenerationCall) rather than parsed
 * into `tool_calls`, since these items are Responses-specific and have no
 * Chat Completions/Anthropic Messages equivalent. Only populated/consumed by
 * the Responses transformer (transformers/responses.ts): dropping one of
 * these instead of re-emitting it natively leaves the client with no signal
 * that a tool call is pending, so the response looks like a completed turn.
 */
export interface UnifiedClientToolCall {
  type: string;
  id: string;
  call_id: string;
  status?: string;
  [key: string]: any;
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
    // Dispatcher retry/routing metadata
    attemptCount?: number;
    finalAttemptProvider?: string;
    finalAttemptModel?: string;
    /** Post-adapter model actually dispatched (providerPayload.model). */
    upstreamModel?: string;
    pricingModel?: string;
    pricingFallback?: boolean;
    allAttemptedProviders?: string;
    retryHistory?: string;
  };
  reasoning_content?: string | null;
  thinking?: {
    content: string;
    signature?: string;
  };
  thought_signature?: string; // New field for direct mapping
  usage?: UnifiedUsage;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  /**
   * Completed image_generation_call output items, typed (see
   * UnifiedImageGenerationCall). The ONLY carrier of unary image output:
   * `content` stays pure authored text. Chat/messages-facing formatters
   * compose their markdown projection from these (see
   * transformers/image-rendering.ts); responses-facing formatters re-emit
   * them natively with no string surgery on the text; empty-completion
   * detection counts entries with a non-empty `result` as visible output.
   */
  image_generation_calls?: UnifiedImageGenerationCall[];
  /**
   * Client-executed built-in tool-call output items, typed (see
   * UnifiedClientToolCall). Same pattern as `image_generation_calls`:
   * responses-facing formatters re-emit them natively so the client sees the
   * pending call and continues the turn.
   */
  client_tool_calls?: UnifiedClientToolCall[];
  annotations?: Annotation[];
  stream?: ReadableStream | any;
  bypassTransformation?: boolean;
  rawResponse?: any;
  rawStream?: ReadableStream;
  finishReason?: string | null;
  clientError?: UnifiedClientError;
}

export interface UnifiedClientError {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Stream event types for block lifecycle management.
 * These events signal the start, delta updates, and end of content blocks.
 */
export type StreamBlockEventType =
  | 'text_start'
  | 'text_delta'
  | 'text_end'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end'
  | 'toolcall_start'
  | 'toolcall_delta'
  | 'toolcall_end'
  | 'message_start'
  | 'message_delta'
  | 'message_end'
  | 'usage'
  | 'error'
  | 'done';

export interface UnifiedChatStreamChunk {
  id: string;
  model: string;
  created: number;
  /** Optional event type for block lifecycle management */
  event?: StreamBlockEventType;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: Array<{
      index?: number; // Stream chunks often have index for tool calls
      id?: string;
      type?: 'function';
      function?: {
        name?: string;
        arguments?: string;
      };
      thought_signature?: string; // New field for direct mapping
    }>;
    reasoning_content?: string | null;
    thinking?: {
      content?: string;
      signature?: string;
    };
  };
  finish_reason?: string | null;
  usage?: UnifiedUsage;
  error?: UnifiedClientError;
  /**
   * Present only on an `event: 'error'` chunk that represents a Responses
   * API "ended incomplete" outcome (`response.incomplete` — e.g.
   * max_output_tokens or content_filter cutoff) rather than a hard failure
   * (`response.failed`). Lets a client-facing `formatStream` render the more
   * specific incomplete semantics (e.g. Responses' own `response.incomplete`
   * event, status 'incomplete') instead of a generic failure.
   */
  incomplete_details?: { reason: string };
  /**
   * Completed image_generation_call items carried typed (see
   * UnifiedImageGenerationCall), paired with their chat-format markdown
   * rendering on `delta.content` in the SAME chunk. Deliberately a CHUNK-level
   * field (not inside `delta`, where tool_calls live): the chat-facing
   * formatters (openai.ts, ollama.ts) forward `delta` BY REFERENCE into the
   * client SSE chunk, so a delta-level field would leak the (possibly
   * multi-megabyte, uncapped) base64 into chat-format wire chunks — top-level
   * unified-chunk fields are never copied by those formatters. The
   * responses-facing formatStream re-emits these as native output items and
   * skips the paired markdown content delta.
   */
  image_generation_calls?: UnifiedImageGenerationCall[];
  /**
   * Client-executed built-in tool-call output items carried typed (see
   * UnifiedClientToolCall), CHUNK-level like `image_generation_calls` above.
   * The responses-facing formatStream re-emits these as native output items;
   * other formatters have no equivalent and simply ignore the field.
   */
  client_tool_calls?: UnifiedClientToolCall[];
  /**
   * Synthetic Claude Code `safeguard_results` attached to the terminal
   * unified chunk when the alias opted into `synthetic_safeguard_approval`.
   * Only the Anthropic stream formatter consumes this; all other formatters
   * ignore it so cross-format streams stay byte-identical.
   */
  safeguard_results?: unknown;
}

// Unified Embeddings Request
export interface UnifiedEmbeddingsRequest {
  requestId?: string;
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

// Unified Embeddings Response
export interface UnifiedEmbeddingsResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
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
  response_format?: 'json' | 'text' | 'verbose_json';
  temperature?: number;

  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

// Unified Transcription Response
export interface UnifiedTranscriptionResponse {
  text: string;

  // Optional fields for verbose_json format
  language?: string;
  duration?: number;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    tokens?: number[];
    temperature?: number;
    avg_logprob?: number;
    compression_ratio?: number;
    no_speech_prob?: number;
  }>;

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
    attemptCount?: number;
    retryHistory?: any;
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
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
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

// Unified Decisions Request
//
// Buffered Jev-style evaluations served by `openrouter-decisions` and
// `typesafe-decisions` targets. `upstreamProvider` carries OpenRouter
// provider-routing preferences verbatim (it is NOT a Plexus provider slug
// and never influences local routing); it is forwarded to OpenRouter only.
// Local failover follows the alias target order, never upstream preferences.
export interface UnifiedDecisionsRequest {
  requestId?: string;
  model: string;
  state: string | Record<string, any> | any[];
  questions: Record<string, DecisionsQuestion>;
  upstreamProvider?: any;
  sessionId?: string;
  trace?: any;
  user?: string;
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

// Unified Decisions Response
export interface UnifiedDecisionsResponse {
  model: string;
  answers: Record<string, DecisionsAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
  /** OpenRouter generation id, when the upstream reports one. */
  id?: string;
  /** Upstream provider name (e.g. `TypeSafe`), when reported. */
  provider?: string;
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    targetApiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}

// Unified Image Generation Request
export type ImageResolution = '512' | '1K' | '2K' | '4K';

export interface UnifiedImageReference {
  type: 'image_url';
  image_url: {
    url: string;
  };
  media_type?: string;
}

export interface UnifiedImageProviderPreferences {
  only?: string[];
  ignore?: string[];
  order?: string[];
  sort?: string | Record<string, any>;
  allow_fallbacks?: boolean;
  options?: Record<string, any>;
}

export interface UnifiedImageGenerationRequest {
  requestId?: string;
  model: string;
  prompt: string;
  n?: number;
  /** OpenRouter's normalized resolution tier. */
  resolution?: ImageResolution;
  /** Normalized ratio, for example `16:9` or `1:1`. */
  aspect_ratio?: string;
  /** Legacy pixel size or OpenRouter's tier-valued convenience size. */
  size?: string;
  response_format?: 'url' | 'b64_json';
  quality?: string;
  style?: string;
  output_format?: 'png' | 'jpeg' | 'webp' | 'svg';
  background?: 'auto' | 'transparent' | 'opaque';
  output_compression?: number;
  seed?: number;
  stream?: boolean;
  input_references?: UnifiedImageReference[];
  /** Optional inpainting mask, kept distinct from an ordinary reference image. */
  mask?: UnifiedImageReference;
  provider?: UnifiedImageProviderPreferences;
  user?: string;
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

// Unified Image Generation Response
export interface UnifiedImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    media_type?: string;
    revised_prompt?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    targetApiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}

/**
 * @deprecated Image edits now travel on `UnifiedImageGenerationRequest`, where
 * the uploaded image is `input_references[0]` and the optional inpainting
 * mask is `mask`. Only the deprecated `Dispatcher.dispatchImageEdits` facade
 * still accepts this shape; convert with `editRequestToGenerationRequest`.
 */
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
  metadata?: Record<string, any> & { plexus_metadata?: PlexusMetadata };
}

/**
 * @deprecated Structurally identical to `UnifiedImageGenerationResponse`, which
 * every image dispatch now returns.
 */
export interface UnifiedImageEditResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    media_type?: string;
    revised_prompt?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    targetApiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  rawResponse?: any;
}
