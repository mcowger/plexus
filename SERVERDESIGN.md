# Plexus Unified Server Design
 
## Purpose
 
This document describes a server-side design for adding a first-class Plexus unified wire API to the Plexus server.
 
The goal is to let first-party clients talk to Plexus using a request/response shape aligned with Plexus's existing `UnifiedChatRequest`, `UnifiedChatResponse`, and `UnifiedChatStreamChunk` concepts instead of forcing those clients through an OpenAI-compatible compatibility layer.
 
This is intentionally **not** a design for turning Plexus into a semantic orchestration system, policy planner, or client capability negotiation engine. Plexus remains what it already is:
 
- a protocol translation layer,
- a routing layer,
- a failover layer,
- a provider adapter layer,
- a quota/usage/debugging layer.
 
The unified wire API exists to remove unnecessary client-side provider compatibility leakage and to make first-party integrations simpler and more consistent.
 
## Core Problem
 
Today, first-party clients such as `pi-plexus` often interact with Plexus through OpenAI-compatible endpoints such as:
 
```http
POST /v1/chat/completions
GET  /v1/models
```
 
That compatibility surface is useful for generic clients, but it causes trouble for first-party clients because the client must express requests using provider-derived fields and conventions such as:
 
- `reasoning_effort` vs `reasoning` vs provider-specific thinking fields,
- `max_tokens` vs `max_completion_tokens`,
- whether `developer` messages are supported,
- provider-specific assistant reasoning field names,
- OpenAI-compatible stream chunk shapes.
 
Plexus already has an internal unified representation and already owns the provider-specific translation/adaptation path. First-party clients should be able to send that unified representation directly instead of first pretending to be OpenAI-compatible.
 
## Design Summary
 
Add a new Plexus-native ingress API type:
 
```ts
'plexus-unified'
```
 
Add server endpoints for unified chat requests and, optionally, unified model metadata:
 
```http
POST /v1/unified/chat
GET  /v1/unified/models
```
 
The unified chat endpoint accepts a wire request that is a deliberate subset of `UnifiedChatRequest`, sets:
 
```ts
incomingApiType: 'plexus-unified'
```
 
and dispatches through the normal Plexus routing, transformer, adapter, failover, quota, usage, and debug machinery.
 
The unified endpoint does **not** use `originalBody`. The request is already in the unified shape; there is no source compatibility format being transformed from.
 
The unified endpoint does **not** use pass-through. No upstream provider speaks the Plexus unified protocol, so every unified request must be transformed to the selected target provider API.
 
## Non-Goals
 
This design is not trying to define:
 
- a semantic planning protocol,
- a high-level model intent language,
- a client capability negotiation framework,
- a long-term enterprise-stable public API separate from Plexus internals,
- a fully provider-agnostic abstraction for every possible future modality.
 
The owner controls both Plexus and the first-party clients. Therefore, it is acceptable for the wire contract to track Plexus's unified internal types closely.
 
## API Type
 
Introduce a first-class API type string:
 
```ts
export const PLEXUS_UNIFIED_API_TYPE = 'plexus-unified' as const;
```
 
This type represents the **incoming client protocol** used at `/v1/unified/chat`.
 
It is not an upstream provider API type. No provider target should be expected to advertise or support `plexus-unified` as an `access_via` value.
 
### API Type Categories
 
Conceptually, Plexus should distinguish between:
 
```ts
type ClientIngressApiType = 'plexus-unified';
```
 
and existing upstream-compatible target API types such as:
 
```ts
type UpstreamTargetApiType =
  | 'chat'
  | 'messages'
  | 'gemini'
  | 'responses'
  | 'ollama'
  | 'oauth'
  | 'embeddings'
  | 'transcriptions'
  | 'speech'
  | 'images';
```
 
The implementation does not need to introduce these exact types immediately, but the invariant should be enforced:
 
> `plexus-unified` is a real incoming API type, but it is never a target provider API type.
 
## Endpoint: `POST /v1/unified/chat`
 
### Intent
 
Accept a Plexus unified chat request directly and dispatch it through the existing server stack.
 
The endpoint should be used by first-party clients that can construct Plexus unified requests directly.
 
### Request Type
 
The request body should be a deliberate subset of `UnifiedChatRequest`.
 
Recommended shape:
 
```ts
export type PlexusWireChatRequest = Pick<
  UnifiedChatRequest,
  | 'messages'
  | 'model'
  | 'max_tokens'
  | 'temperature'
  | 'stream'
  | 'tools'
  | 'tool_choice'
  | 'toolConfig'
  | 'reasoning'
  | 'include'
  | 'prompt_cache_key'
  | 'systemInstruction'
  | 'text'
  | 'parallel_tool_calls'
  | 'response_format'
  | 'cacheRoutingHeaders'
  | 'metadata'
>;
```
 
This intentionally excludes:
 
- `requestId` — server-owned,
- `incomingApiType` — server-owned and always set to `'plexus-unified'`,
- `originalBody` — not meaningful for this API.
 
An `Omit<>` form is also acceptable if preferred:
 
```ts
export type PlexusWireChatRequest = Omit<
  UnifiedChatRequest,
  'requestId' | 'incomingApiType' | 'originalBody'
>;
```
 
The `Pick<>` form is slightly more explicit and makes the wire contract intentional.
 
### Server Construction
 
The route should construct the internal request approximately like this:
 
```ts
const unifiedRequest: UnifiedChatRequest = {
  ...body,
  requestId,
  incomingApiType: 'plexus-unified',
};
```
 
It should not set:
 
```ts
originalBody
```
 
because this endpoint is not parsing another provider's wire format.
 
### Response Type
 
For non-streaming responses, the endpoint may return `UnifiedChatResponse` directly:
 
```ts
export type PlexusWireChatResponse = UnifiedChatResponse;
```
 
This is acceptable because this API is controlled on both sides and intentionally aligned with Plexus internals.
 
### Streaming Response
 
For streaming requests, the endpoint should stream `UnifiedChatStreamChunk` values directly over SSE.
 
Recommended minimal format:
 
```text
event: chunk
data: {JSON serialized UnifiedChatStreamChunk}
 
...
 
event: done
data: {}
```
 
The server does not need to emit OpenAI-style `chat.completion.chunk` objects for this endpoint.
 
The endpoint may also include error events if that matches existing Plexus streaming conventions, but the core payload should remain `UnifiedChatStreamChunk`.
 
## Endpoint: `GET /v1/unified/models`
 
### Intent
 
Expose model metadata for clients using the unified API type.
 
This endpoint should reuse the same alias and metadata sources as `/v1/models`, but it should not expose upstream provider compatibility details as client request-formatting instructions.
 
### Recommended Shape
 
The response can remain close to the existing OpenRouter/OpenAI-style model list, but should avoid fields that imply client-side upstream provider compatibility.
 
Example:
 
```ts
interface PlexusUnifiedModelsResponse {
  object: 'list';
  api: 'plexus-unified';
  data: PlexusUnifiedModelEntry[];
}
 
interface PlexusUnifiedModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: 'plexus';
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: PlexusModelArchitecture;
  pricing?: PlexusModelPricing;
  supported_parameters?: string[];
  top_provider?: PlexusTopProvider;
  preferred_api?: string[];
}
```
 
The server may initially return the same entries as `/v1/models` minus `pi_options` if that is simpler.
 
### Fields to Avoid
 
The unified models endpoint should not expose fields that encourage a unified client to format requests according to upstream provider quirks, such as:
 
- `pi_options`,
- upstream `OpenAICompletionsCompat`,
- `supportsDeveloperRole`,
- `thinkingFormat`,
- `maxTokensField`,
- provider-specific reasoning field hints.
 
Those are server-side transformation/adaptation concerns.
 
### Relationship to `/v1/models`
 
`GET /v1/models` should remain available for compatibility clients.
 
It may continue exposing legacy fields such as `pi_options` for older clients if needed.
 
`GET /v1/unified/models` is the preferred metadata endpoint for clients using `api: 'plexus-unified'`.
 
## Unified Message Role Changes
 
The internal `UnifiedMessage` type should allow `developer` messages.
 
Current shape conceptually resembles:
 
```ts
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  // ...
}
```
 
Update to:
 
```ts
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
  // ...
}
```
 
This is appropriate because `developer` is a real message role used by first-party clients and already handled operationally by Plexus adapters such as `suppress_developer_role`.
 
Provider transformers and adapters should decide how to express or suppress this role for each upstream target.
 
## Routing Invariants
 
### `plexus-unified` Is a Real Incoming Type
 
Unified requests must be recorded with:
 
```ts
incomingApiType: 'plexus-unified'
```
 
This should appear in:
 
- logs,
- usage records,
- debug records,
- request metadata where appropriate.
 
It should not be omitted or represented as `undefined`.
 
### `plexus-unified` Does Not Constrain Target API Matching
 
Because `plexus-unified` is not an upstream provider API type, it should not participate in target API matching.
 
Router logic like API-match filtering should only apply when `incomingApiType` is an upstream target API type.
 
Conceptually:
 
```ts
if (alias.priority === 'api_match' && isUpstreamTargetApiType(incomingApiType)) {
  // Filter targets by access_via/provider API support.
}
```
 
For `incomingApiType === 'plexus-unified'`, routing should proceed according to the alias target groups, selectors, cooldown state, concurrency state, failover config, and provider/model configuration without trying to find providers that support `plexus-unified`.
 
### Target API Selection
 
Dispatcher target API selection should also ignore `plexus-unified` as a target match candidate.
 
Conceptually:
 
```ts
if (isUpstreamTargetApiType(incomingApiType)) {
  // Try to match incoming API type against available target APIs.
} else if (incomingApiType === 'plexus-unified') {
  // Use configured target API preference/default.
}
```
 
Selection logs should make this clear, for example:
 
```text
client API type 'plexus-unified' does not constrain upstream API; using configured target API preference
```
 
## Pass-Through Invariant
 
The unified endpoint never uses pass-through.
 
Reason:
 
> No upstream provider speaks the Plexus unified protocol.
 
Pass-through is a compatibility optimization for cases where the incoming client API and outgoing provider API are the same external protocol. That condition can never be true for `plexus-unified`.
 
The implementation may naturally avoid pass-through because `originalBody` is absent. However, the invariant should also be explicit in the dispatcher:
 
```ts
if (isClientIngressApiType(request.incomingApiType)) {
  return false;
}
```
 
This makes the design clear and prevents future accidental pass-through if someone later changes request construction.
 
## `originalBody` Invariant
 
`originalBody` is a compatibility-transform concept.
 
It exists when Plexus receives some external provider-style wire format and parses it into a `UnifiedChatRequest`, for example:
 
```text
OpenAI request body -> UnifiedChatRequest
Anthropic request body -> UnifiedChatRequest
Gemini request body -> UnifiedChatRequest
```
 
For `/v1/unified/chat`, there is no such source format. The body is already unified.
 
Therefore:
 
> Unified wire requests should not set `originalBody`.
 
This keeps the unified route conceptually clean and prevents accidental pass-through behavior.
 
## Request Flow
 
The desired request flow is:
 
```text
Client
  -> POST /v1/unified/chat
  -> PlexusWireChatRequest
  -> UnifiedChatRequest with incomingApiType='plexus-unified'
  -> Router resolves alias/target candidates
  -> Dispatcher selects target API from provider/model config
  -> Target transformer converts UnifiedChatRequest to provider payload
  -> Provider/model adapters apply
  -> Upstream request executes
  -> Response transforms back to UnifiedChatResponse or UnifiedChatStreamChunk
  -> Unified response/chunks returned to client
```
 
The unified route enters Plexus after client compatibility parsing and before provider transformation.
 
## Error Handling Expectations
 
The unified endpoint should follow existing Plexus route conventions for:
 
- assigning `x-request-id`,
- recording usage status,
- handling quota failures,
- handling upstream failures,
- handling failover exhaustion,
- preserving enriched routing context on errors,
- saving debug logs.
 
Error response shape does not need to mimic OpenAI for this endpoint. It can use a simple Plexus-native error envelope, but should include enough information for first-party clients to show useful diagnostics.
 
A minimal shape:
 
```ts
interface PlexusUnifiedErrorResponse {
  error: {
    message: string;
    code?: string;
    type?: string;
    routingContext?: unknown;
  };
}
```
 
The exact error type can be refined during implementation.
 
## Usage and Debugging Expectations
 
Unified requests should be visible in existing usage/debugging systems.
 
Expected values:
 
```ts
incomingApiType: 'plexus-unified'
incomingModelAlias: body.model
isStreamed: !!body.stream
```
 
Debug logs should capture:
 
- incoming unified request,
- selected route,
- target API type,
- transformed provider request,
- provider response metadata,
- raw/transformed response where existing debug settings allow it.
 
The unified endpoint does not need OpenAI-format reconstruction.
 
## Compatibility Endpoints Remain
 
This design does not remove or weaken existing compatibility endpoints.
 
Generic clients should continue using:
 
```http
POST /v1/chat/completions
POST /v1/messages
POST /v1/responses
POST /v1beta/models/...:generateContent
GET  /v1/models
```
 
The unified API is an additional first-party route for clients that can speak Plexus's unified shape directly.
 
## Relationship to Provider Adapters
 
Provider adapters remain the correct place for upstream-specific quirks.
 
Examples:
 
- `suppress_developer_role` rewrites `developer` messages for providers that reject them.
- `reasoning_rewrite` maps unified reasoning fields to provider-specific fields.
- `reasoning_content` handles assistant reasoning content field naming.
- `model_override` handles providers that express reasoning variants as different model IDs.
 
The unified wire API should reduce the need for clients to know when these adapters are required, but it does not replace the adapters.
 
## Relationship to `pi_model` and `pi_options`
 
Existing `/v1/models` behavior may continue exposing `pi_provider`, `pi_model`, and `pi_options` for compatibility clients.
 
However, these fields should not be part of the unified client request-formatting contract.
 
For unified clients:
 
- upstream pi-ai model compatibility is a server-side concern,
- client request formatting is based on `UnifiedChatRequest`,
- provider quirks are handled by server transformers/adapters.
 
If `/v1/unified/models` includes `pi_provider` or `pi_model` for debugging/display, those fields must not imply that the client should format requests according to that upstream provider's compat profile.
 
## Server Implementation Expectations
 
A likely implementation will include:
 
1. Add the `plexus-unified` API type constant/helper.
2. Add `developer` to `UnifiedMessage.role`.
3. Add `PlexusWireChatRequest` and response aliases/types.
4. Add `POST /v1/unified/chat` route.
5. Add unified SSE stream formatting for `UnifiedChatStreamChunk`.
6. Update router API-match filtering to ignore client-only API types.
7. Update dispatcher target API selection to treat `plexus-unified` as client-only.
8. Update dispatcher pass-through eligibility to explicitly reject client-only API types.
9. Add `GET /v1/unified/models` or defer it until the client work begins.
10. Add focused tests for routing, pass-through invariants, developer role acceptance, and unified stream output.
 
## Important Tests
 
At minimum, server tests should verify:
 
### Unified Route Sets Incoming Type
 
A request to `/v1/unified/chat` dispatches with:
 
```ts
incomingApiType === 'plexus-unified'
```
 
and usage/debug records reflect that value.
 
### Unified Route Does Not Set `originalBody`
 
The constructed `UnifiedChatRequest` should not include `originalBody`.
 
### Unified Route Never Passes Through
 
Even if a selected target API is `chat`, the dispatcher should transform the unified request rather than copying the original body.
 
### `api_match` Does Not Filter on `plexus-unified`
 
For aliases using `priority: 'api_match'`, incoming `plexus-unified` should not cause all targets to be filtered out merely because no target advertises that API.
 
### Target API Selection Ignores `plexus-unified`
 
Dispatcher should choose the provider/model configured target API preference rather than trying to match `plexus-unified`.
 
### Developer Role Is Accepted
 
A unified request containing:
 
```ts
{ role: 'developer', content: '...' }
```
 
should parse and dispatch successfully.
 
Provider-specific handling remains transformer/adapter dependent.
 
### Stream Chunks Are Unified
 
Streaming `/v1/unified/chat` should emit serialized `UnifiedChatStreamChunk` values, not OpenAI `chat.completion.chunk` objects.
 
## Final Invariants
 
The design is governed by these invariants:
 
1. `plexus-unified` is a real incoming API type.
2. `plexus-unified` is not an upstream provider API type.
3. Unified wire requests do not have `originalBody`.
4. Unified wire requests never use pass-through.
5. Unified wire request/response shapes intentionally align with Plexus unified internal types.
6. Provider-specific quirks remain server-side transformer/adapter concerns.
7. Compatibility endpoints remain available for generic clients.
8. First-party clients should use the unified API instead of OpenAI-compatible request formatting when possible.
