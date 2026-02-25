# Comprehensive Review: Gemini API Implementation Gaps & Variances

## Executive Summary
I've analyzed the Plexus Gemini endpoint implementation against three reference implementations:
1. pi-mono - Full-featured TypeScript provider implementation (GoogleGenAI SDK)
2. CLIProxyAPI - Go-based proxy with Gemini handlers
3. axonhub - Go-based transformer with extensive Gemini inbound/outbound support
Below are the detailed gaps and variances I identified:

---

## 1. Request Parsing - Input Field Coverage

| Field | Plexus | pi-mono | axonhub | CLIProxyAPI |
|-------|--------|---------|---------|-------------|
| contents | ✅ | ✅ | ✅ | ✅ |
| generationConfig.temperature | ✅ | ✅ | ✅ | ✅ |
| generationConfig.maxOutputTokens | ✅ | ✅ | ✅ | ✅ |
| generationConfig.topP | ❌ | ✅ | ✅ | ✅ |
| generationConfig.topK | ❌ | ✅ | ✅ | ✅ |
| generationConfig.stopSequences | ❌ | ✅ | ✅ | ✅ |
| generationConfig.seed | ❌ | ✅ | ✅ | ✅ |
| generationConfig.frequencyPenalty | ❌ | ✅ | ✅ | ✅ |
| generationConfig.presencePenalty | ❌ | ✅ | ✅ | ✅ |
| generationConfig.responseMimeType | ✅ | ✅ | ✅ | ✅ |
| generationConfig.responseSchema (as responseJsonSchema) | ✅ | ✅ | ✅ | ✅ |
| generationConfig.thinkingConfig | ✅ | ✅ | ✅ | ✅ |
| generationConfig.imageConfig | ❌ | ❌ | ✅ | ❌ |
| generationConfig.responseModalities | ❌ | ❌ | ✅ | ❌ |
| systemInstruction | ❌ | ✅ | ✅ | ✅ |
| tools | ✅ | ✅ | ✅ | ✅ |
| toolConfig | ❌ | ✅ | ✅ | ✅ |
| safetySettings | ❌ | ❌ | ✅ | ❌ |
| cachedContent | ❌ | ✅ | ✅ | ❌ |
Gap 1: Plexus doesn't handle systemInstruction in incoming requests. The reference implementations extract system prompts from systemInstruction and convert them to the first user message. axonhub:112-125 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L112-L125), pi-mono:345 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google.ts#L345)

Gap 2: Plexus doesn't map topP, topK, stopSequences, seed, frequencyPenalty, presencePenalty from generationConfig. These are important for advanced use cases. axonhub:38-60 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L38-L60)

Gap 3: Plexus doesn't handle toolConfig (function calling configuration like mode: auto/none/any). axonhub:226-230 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L226-L230)

---

## 2. Tool/Function Calling - Advanced Features

| Feature | Plexus | pi-mono | axonhub | CLIProxyAPI |
|---------|--------|---------|---------|-------------|
| Function declarations | ✅ | ✅ | ✅ | ✅ |
| parametersJsonSchema (new format) | ❌ | ✅ | ✅ | ✅ |
| parameters (legacy format) | ✅ | ✅ | ✅ | ✅ |
| Google Search tool | ❌ | ❌ | ✅ | ❌ |
| Code Execution tool | ❌ | ❌ | ✅ | ❌ |
| URL Context tool | ❌ | ❌ | ✅ | ❌ |
| Tool choice (auto/none/any) | ❌ | ✅ | ✅ | ✅ |
| Multimodal function responses | ❌ | ❌ | ✅ | ❌ |
Gap 4: Plexus doesn't support the parametersJsonSchema field (the newer format supporting full JSON Schema including anyOf, oneOf, const). Reference implementations check for both parameters and parametersJsonSchema. pi-mono:251 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-shared.ts#L251), axonhub:165-174 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L165-L174)
Gap 5: Plexus doesn't handle Google's built-in tools (Google Search, Code Execution, URL Context). These are passed through in axonhub. axonhub:189-220 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L189-L220)

---

## 3. Thinking/Reasoning - Thought Signatures

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| thought: true detection | ✅ | ✅ | ✅ |
| thoughtSignature propagation | ⚠️ Partial | ✅ | ✅ |
| Signature validation (base64) | ❌ | ✅ | ✅ |
| Cross-model signature handling | ❌ | ✅ | ✅ |
| Signature on function calls | ⚠️ Partial | ✅ | ✅ |
Gap 6: Plexus doesn't validate thought signatures for base64 format. pi-mono has explicit validation: pi-mono:46-52 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-shared.ts#L46-L52)
// pi-mono has this validation
const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;
function isValidThoughtSignature(signature: string | undefined): boolean {
  if (!signature) return false;
  if (signature.length % 4 !== 0) return false;
  return base64SignaturePattern.test(signature);
}
Gap 7: Plexus doesn't handle cross-model thinking signature preservation. pi-mono explicitly checks if the message is from the same provider/model before preserving thinking blocks: pi-mono:109-110 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-shared.ts#L109-L110)
const isSameProviderAndModel = msg.provider === model.provider && msg.model === model.id;
Gap 8: Plexus has incomplete thoughtSignature handling on function calls. pi-mono propagates signature to function calls: pi-mono:183 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-shared.ts#L183)

---

## 4. Streaming Implementation

| Feature | Plexus | pi-mono | axonhub | CLIProxyAPI |
|---------|--------|---------|---------|-------------|
| SSE parsing | ✅ | ✅ | ✅ | ✅ |
| Text deltas | ✅ | ✅ | ✅ | ✅ |
| Thinking deltas | ✅ | ✅ | ✅ | ✅ |
| Tool call deltas | ⚠️ Partial | ✅ | ✅ | ✅ |
| Block lifecycle events | ❌ | ✅ | ✅ | ❌ |
| Usage in stream chunks | ✅ | ✅ | ✅ | ✅ |
Gap 9: Plexus doesn't emit block lifecycle events (text_start, text_end, thinking_start, thinking_end, toolcall_start, toolcall_end). pi-mono has sophisticated event streaming with these events. pi-mono:96-147 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google.ts#L96-L147)
Gap 10: Plexus doesn't handle tool call deltas properly - it sends the entire function call at once rather than streaming the arguments. pi-mono has separate toolcall_delta events for incremental argument streaming. pi-mono:187-194 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google.ts#L187-L194)

---

## 5. Content/Part Types

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| Text parts | ✅ | ✅ | ✅ |
| Inline data (base64 images) | ✅ | ✅ | ✅ |
| File data (URIs) | ✅ | ✅ | ✅ |
| Document type (PDF, Word) | ❌ | ❌ | ✅ |
| Audio/video content | ❌ | ❌ | ❌ |
| Grounding metadata | ❌ | ❌ | ✅ |
Gap 11: Plexus doesn't handle document MIME types (PDF, Word) - axonhub detects document types and converts them appropriately. axonhub:320-328 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L320-L328)
Gap 12: Plexus doesn't propagate GroundingMetadata in responses. This is important for Gemini's search-grounded responses. axonhub:432-435 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound_convert.go#L432-L435)

---

## 6. Error Handling

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| Basic error responses | ✅ | N/A | ✅ |
| HTTP status → Gemini status mapping | ❌ | N/A | ✅ |
| Detailed error types | ❌ | N/A | ✅ |
Gap 13: Plexus doesn't map HTTP status codes to Gemini-specific error status strings. axonhub has comprehensive mapping: axonhub:197-221 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/inbound.go#L197-L221)

// axonhub maps:
// 400 → "INVALID_ARGUMENT"
// 401 → "UNAUTHENTICATED"
// 403 → "PERMISSION_DENIED"
// 404 → "NOT_FOUND"
// 429 → "RESOURCE_EXHAUSTED"
// 500 → "INTERNAL"

---

## 7. Finish Reason Mapping

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| STOP | ✅ | ✅ | ✅ |
| MAX_TOKENS | ✅ | ✅ | ✅ |
| Safety/blocklist reasons | ❌ | ✅ | ✅ |
| toolUse detection | ❌ | ✅ | ✅ |
Gap 14: Plexus doesn't detect toolUse as a finish reason when tool calls are present. pi-mono checks: pi-mono:201-203 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google.ts#L201-L203)
if (output.content.some((b) => b.type === "toolCall")) {
  output.stopReason = "toolUse";
}
Gap 15: Plexus doesn't handle safety-related finish reasons (BLOCKLIST, PROHIBITED_CONTENT, SPII, SAFETY, etc.) - pi-mono maps these to "error". pi-mono:282-297 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-shared.ts#L282-L297)

---

## 8. Request Building - Output Field Coverage

| Field | Plexus | pi-mono | axonhub |
|-------|--------|---------|---------|
| contents | ✅ | ✅ | ✅ |
| generationConfig | ⚠️ Partial | ✅ | ✅ |
| tools | ✅ | ✅ | ✅ |
| systemInstruction | ❌ | ✅ | ✅ |
| toolConfig | ❌ | ✅ | ✅ |
| safetySettings | ❌ | ✅ | ✅ |
| cachedContent | ❌ | ✅ | ✅ |
Gap 16: Plexus doesn't build systemInstruction in outbound requests to providers. This should be extracted from unified messages and placed in systemInstruction. pi-mono:345 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google.ts#L345)

---

## 9. Vertex AI Specific

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| Vertex AI support | ❌ | ✅ | ✅ |
| Project/location handling | ❌ | ✅ | ✅ |
| Different URL format | ❌ | ✅ | ✅ |
| Function call ID clearing | ❌ | ❌ | ✅ |
Gap 17: Plexus doesn't support Vertex AI. This requires different URL format and auth handling. pi-mono:318-339 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/providers/google-vertex.ts#L318-L339)
Gap 18: For Vertex AI, function call IDs should be cleared (not supported). axonhub handles this: axonhub:125-128 (file:///Users/matt.cowger/workspace/axonhub/llm/transformer/gemini/outbound.go#L125-L128)

---

## 10. Utilities & Sanitization

| Feature | Plexus | pi-mono | axonhub |
|---------|--------|---------|---------|
| Unicode surrogate sanitization | ❌ | ✅ | ❌ |
| Provider/model tracking | ⚠️ Partial | ✅ | ✅ |
Gap 19: pi-mono sanitizes unpaired Unicode surrogates that cause JSON serialization errors. This is critical for handling emoji and special characters. pi-mono:20-26 (file:///Users/matt.cowger/workspace/pi-mono/packages/ai/src/utils/sanitize-unicode.ts#L20-L26)

---

## Summary of Priority Gaps

### High Priority (Functional Gaps):
1. No systemInstruction handling
2. No toolConfig (function calling mode)
3. Missing generation config fields (topP, topK, stopSequences, seed, etc.)
4. No block lifecycle events in streaming
5. No tool call delta streaming
### Medium Priority (Advanced Features):

6. No thought signature validation
7. No cross-model thinking preservation
8. No Vertex AI support
9. No safety/settings pass-through
10. No document type handling

### Lower Priority:

11. Error status mapping
12. Unicode sanitization
13. Built-in Google tools support