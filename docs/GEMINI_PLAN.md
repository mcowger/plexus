# Gemini Implementation Plan

This document outlines the detailed implementation plan to address the identified gaps in the Plexus Gemini endpoint implementation.

---

## Gap 1: systemInstruction Handling

### Problem
Plexus doesn't handle `systemInstruction` in incoming requests. The reference implementations extract system prompts from `systemInstruction` and convert them to the first user message.

### Reference Implementations
- axonhub:112-125
- pi-mono:345

### Implementation Plan

1. **Add systemInstruction field to UnifiedChatRequest type**
   ```typescript
   // In types/unified-chat.ts
   interface UnifiedChatRequest {
     // ... existing fields
     systemInstruction?: UnifiedMessage;
   }
   ```

2. **Update inbound transformer** (`packages/backend/src/transformers/gemini/inbound.ts`)
   - Extract `systemInstruction` from incoming Gemini request
   - Convert to UnifiedMessage format
   - Store in unified request

3. **Update outbound transformer** (`packages/backend/src/transformers/gemini/outbound.ts`)
   - Extract system instruction from unified messages (role: "system")
   - Build `systemInstruction` object in Gemini format
   - Place in outbound request body

4. **Handle edge cases**
   - Multiple system messages: concatenate or error
   - System message with tools: ensure correct ordering
   - Empty system instruction: skip field entirely

---

## Gap 3: toolConfig (Function Calling Configuration)

### Problem
Plexus doesn't handle `toolConfig` (function calling configuration like mode: auto/none/any).

### Reference Implementations
- axonhub:226-230

### Implementation Plan

1. **Add toolConfig to UnifiedChatRequest type**
   ```typescript
   interface ToolConfig {
     mode?: 'auto' | 'none' | 'any';
     functionCallingPreference?: string;
   }
   ```

2. **Update inbound transformer**
   - Map incoming `toolConfig.mode` to unified format
   - Map `toolConfig.functionCallingPreference` if present

3. **Update outbound transformer**
   - Convert unified toolConfig back to Gemini format
   - Handle all three modes: auto, none, any

4. **Add to config options in unified request**
   ```typescript
   interface UnifiedChatRequest {
     // ...
     toolConfig?: ToolConfig;
   }
   ```

---

## Gap 4: parametersJsonSchema Support

### Problem
Plexus doesn't support the `parametersJsonSchema` field (the newer format supporting full JSON Schema including anyOf, oneOf, const).

### Reference Implementations
- pi-mono:251
- axonhub:165-174

### Implementation Plan

1. **Update tool/function definition types**
   ```typescript
   interface FunctionDeclaration {
     name: string;
     description?: string;
     parameters?: Schema; // Legacy format
     parametersJsonSchema?: Schema; // New format
   }
   ```

2. **Update inbound transformer**
   - Check for both `parameters` and `parametersJsonSchema`
   - Prefer `parametersJsonSchema` if both present
   - Convert to unified format

3. **Update outbound transformer**
   - Output `parametersJsonSchema` for Gemini 2.0+ compatibility
   - Fall back to `parameters` for older models

4. **Add schema validation tests**
   - anyOf, oneOf, const constructs
   - Nested object schemas
   - Array items with schema

---

## Gap 5: Google Built-in Tools

### Problem
Plexus doesn't handle Google's built-in tools (Google Search, Code Execution, URL Context).

### Reference Implementations
- axonhub:189-220

### Implementation Plan

1. **Define built-in tool types**
   ```typescript
   type GoogleBuiltInTool = 
     | { type: 'googleSearch' }
     | { type: 'codeExecution' }
     | { type: 'urlContext' };

   interface UnifiedTool {
     type: 'function' | 'googleSearch' | 'codeExecution' | 'urlContext';
     function?: FunctionDeclaration;
   }
   ```

2. **Update inbound transformer**
   - Detect built-in tool types in request
   - Pass through to unified format

3. **Update outbound transformer**
   - Convert built-in tools to Gemini format:
     ```json
     {
       "googleSearch": {}
     }
     ```
   - Preserve tool ordering

4. **Add streaming support**
   - Handle Google Search results in streaming responses
   - Handle code execution results

---

## Gaps 6, 7, 8: Thought Signature Handling

### Problem
Plexus has incomplete thought signature handling:
- Gap 6: No base64 validation
- Gap 7: No cross-model thinking preservation
- Gap 8: Incomplete signature on function calls

### Reference Implementations
- pi-mono:46-52 (validation)
- pi-mono:109-110 (cross-model)
- pi-mono:183 (function call signature)

### Implementation Plan

#### Gap 6: Signature Validation

1. **Create validation utility** (`packages/backend/src/transformers/gemini/utils/thought-signature.ts`)
   ```typescript
   const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

   export function isValidThoughtSignature(signature: string | undefined): boolean {
     if (!signature) return false;
     if (signature.length % 4 !== 0) return false;
     return base64SignaturePattern.test(signature);
   }
   ```

2. **Apply validation in inbound transformer**
   - Validate signatures on incoming thinking blocks
   - Log warnings for invalid signatures
   - Strip invalid signatures rather than failing

#### Gap 7: Cross-Model Signature Preservation

1. **Track provider/model in unified messages**
   ```typescript
   interface UnifiedMessage {
     // ...
     provider?: string;
     model?: string;
   }
   ```

2. **Add preservation logic**
   ```typescript
   function shouldPreserveThinking(msg: UnifiedMessage, targetModel: ModelInfo): boolean {
     return msg.provider === targetModel.provider && msg.model === targetModel.id;
   }
   ```

3. **Handle cross-model scenarios**
   - Different provider: strip thinking blocks
   - Same provider, different model: preserve but warn
   - Same provider + model: preserve fully

#### Gap 8: Function Call Signatures

1. **Propagate signature to function calls**
   - Extract signature from thinking block
   - Attach to corresponding tool call

2. **Handle streaming function calls**
   - Include signature in toolcall_start event
   - Maintain signature consistency across deltas

---

## Gap 9: Block Lifecycle Events in Streaming

### Problem
Plexus doesn't emit block lifecycle events (text_start, text_end, thinking_start, thinking_end, toolcall_start, toolcall_end).

### Reference Implementations
- pi-mono:96-147

### Implementation Plan

1. **Define event types**
   ```typescript
   type StreamEventType = 
     | 'text_start'
     | 'text_delta'
     | 'text_end'
     | 'thinking_start'
     | 'thinking_delta'
     | 'thinking_end'
     | 'toolcall_start'
     | 'toolcall_delta'
     | 'toolcall_end'
     | 'usage'
     | 'done';

   interface StreamEvent {
     type: StreamEventType;
     data?: unknown;
   }
   ```

2. **Update streaming transformer**
   - Track block state machine (started, in-progress, ended)
   - Emit appropriate events as blocks are parsed
   - Ensure correct ordering

3. **Event emission logic**
   ```
   Receiving "content" block with type "text" →
     text_start event
     [stream text deltas]
     text_end event

   Receiving "content" block with type="thinking" →
     thinking_start event
     [stream thought deltas]
     thinking_end event

   Receiving function call →
     toolcall_start event
     [stream argument deltas]
     toolcall_end event
   ```

4. **Add to SSE response format**
   ```typescript
   // Ensure events are properly formatted
   event: text_start
   data: {}

   event: text_delta
   data: {"text": "..."}
   ```

---

## Gap 12: GroundingMetadata Propagation

### Problem
Plexus doesn't propagate GroundingMetadata in responses. This is important for Gemini's search-grounded responses.

### Reference Implementations
- axonhub:432-435

### Implementation Plan

1. **Add GroundingMetadata type**
   ```typescript
   interface GroundingMetadata {
     groundings?: Array<{
       blockId: string;
       confidenceScore: number;
       text: string;
       url?: string;
     }>;
     webSearchQueries?: string[];
     searchEntryPoint?: {
       renderedContent: string;
     };
   }
   ```

2. **Update outbound response transformer**
   - Extract `groundingMetadata` from Gemini response
   - Map to unified response format
   - Include in SSE events

3. **Handle different grounding formats**
   - Search results
   - Vertex AI grounding
   - Inline citations

---

## Gap 14: toolUse Finish Reason Detection

### Problem
Plexus doesn't detect `toolUse` as a finish reason when tool calls are present.

### Reference Implementations
- pi-mono:201-203

### Implementation Plan

1. **Update finish reason detection logic**
   ```typescript
   function determineFinishReason(
     response: GeminiResponse,
     content: Content[]
   ): FinishReason {
     // Existing checks...
     if (content.some((b) => b.type === "toolCall")) {
       return "toolUse";
     }
     // ... other mappings
   }
   ```

2. **Handle tool call as terminal state**
   - When model returns tool calls and stops
   - Map to "toolUse" rather than "stop"

3. **Consider streaming scenarios**
   - Detect tool calls mid-stream
   - May need to adjust finish reason if more tool calls pending

---

## Gap 19: Unicode Sanitization

### Problem
pi-mono sanitizes unpaired Unicode surrogates that cause JSON serialization errors. This is critical for handling emoji and special characters.

### Reference Implementations
- pi-mono:20-26

### Implementation Plan

1. **Create sanitization utility** (`packages/backend/src/utils/sanitize-unicode.ts`)
   ```typescript
   /**
    * Removes unpaired Unicode surrogates that cause JSON serialization errors.
    * These can occur with certain emoji and special characters.
    */
   export function sanitizeUnicode(input: string): string {
     // Remove unmatched high surrogates (D800-DBFF)
     let result = input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
     
     // Remove unmatched low surrogates (DC00-DFFF)
     result = result.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
     
     return result;
   }
   ```

2. **Apply sanitization at key points**
   - Before sending requests to providers
   - When processing response content
   - In streaming delta handling

3. **Add to utility exports**
   ```typescript
   // packages/backend/src/transformers/gemini/utils/index.ts
   export { sanitizeUnicode } from './sanitize-unicode';
   ```

4. **Create test cases**
   - Single high surrogate
   - Single low surrogate
   - Reversed surrogate pair
   - Emoji with variation selector
   - Complex emoji sequences

---

## Implementation Order

### Phase 1: Core Request/Response Handling
1. Gap 1: systemInstruction (both directions)
2. Gap 19: Unicode sanitization (utility)
3. Gap 3: toolConfig

### Phase 2: Tool/Function Enhancements
4. Gap 4: parametersJsonSchema
5. Gap 5: Built-in tools
6. Gap 14: toolUse finish reason

### Phase 3: Streaming & Advanced Features
7. Gap 9: Block lifecycle events
8. Gap 12: GroundingMetadata
9. Gaps 6,7,8: Thought signatures

---

## Testing Requirements

For each gap implementation:

1. **Unit tests** for utility functions
2. **Integration tests** with mock Gemini API
3. **Round-trip tests**: Request → Transform → API → Transform → Response
4. **Streaming tests** for event handling

### Test Files to Update/Create
- `packages/backend/src/transformers/gemini/__tests__/inbound.test.ts`
- `packages/backend/src/transformers/gemini/__tests__/outbound.test.ts`
- `packages/backend/src/transformers/gemini/__tests__/streaming.test.ts`