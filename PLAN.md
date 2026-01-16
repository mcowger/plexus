# Gemini v1beta Endpoint Implementation Plan

## Overview
Implement native Gemini API v1beta endpoint support in Plexus to handle requests with model and action in the URL path (e.g., `/v1beta/models/gemini-1.5-pro:streamGenerateContent`), following the Gemini API's URL-based routing pattern.

## Current State Analysis

### What Works Now
- ✅ `GeminiTransformer` (`server/transformers/gemini.ts`) is fully implemented
- ✅ Transformer factory recognizes "gemini" as an ApiType
- ✅ Dispatcher can handle "gemini" apiType in `getEndpointUrl()` (line 471-473)
- ✅ Existing routes: `/v1/chat/completions` (OpenAI) and `/v1/messages` (Anthropic)

### What's Missing
- ❌ No `/v1beta/models/:modelWithAction` route in server.ts
- ❌ No route handler for Gemini-style requests
- ❌ URL parameter parsing for model name and action (`:generateContent` or `:streamGenerateContent`)
- ❌ Automatic stream detection from URL action
- ❌ Dispatcher method for handling Gemini-native API calls

## Implementation Plan

### Phase 1: Create Gemini Route Handler
**File:** `server/routes/gemini.ts` (NEW)

**Purpose:** Handle incoming Gemini v1beta API requests

**Key Requirements:**
1. Parse URL parameters to extract `modelWithAction`
2. Split `modelWithAction` into:
   - `modelName` (before the `:`)
   - `action` (after the `:`)
3. Determine if streaming based on action name:
   - Contains `streamGenerateContent` → `stream: true`
   - Contains `generateContent` (without stream) → `stream: false`
4. Set the model in request body from URL parameter
5. Validate authentication
6. Create Dispatcher and call new `dispatchGemini()` method
7. Handle Gemini-specific validation (optional, based on Gemini schema)

**Implementation Pattern:**
```typescript
export async function handleGemini(
  req: Request,
  context: ServerContext,
  requestId: string,
  clientIp: string,
  modelWithAction: string  // From URL params
): Promise<Response>
```

**Key Logic:**
```typescript
// Parse URL components
const modelName = modelWithAction.split(':')[0];
const action = modelWithAction.split(':')[1] || 'generateContent';

// Parse body
const body = await req.json();

// Inject model and stream flag into body
body.model = modelName;
if (action.includes('streamGenerateContent')) {
  body.stream = true;
}

// Track in usage logging
// usageRecord.incomingModelAlias = modelName;

// Dispatch using new method
const dispatcher = new Dispatcher(context);
return dispatcher.dispatchGemini(body, requestId, clientIp, auth.apiKeyName);
```

### Phase 2: Update Dispatcher
**File:** `server/services/dispatcher.ts`

**Changes:**

1. **Add `dispatchGemini()` method** (similar to `dispatchChatCompletion` and `dispatchMessages`):
   ```typescript
   /**
    * Dispatch a Gemini request (Gemini native format)
    * Convenience method that calls dispatch with clientApiType="gemini"
    */
   async dispatchGemini(
     request: any,
     requestId: string,
     clientIp?: string,
     apiKeyName?: string
   ): Promise<Response> {
     return this.dispatch(request, requestId, "gemini", clientIp, apiKeyName);
   }
   ```

2. **Update `getEndpointUrl()`** - Already supports "gemini" (line 471-473), no changes needed ✅

3. **Verify `dispatch()` method** - Already handles any ApiType including "gemini" via transformer factory ✅

**Why This Works:**
- The existing `dispatch()` method is API-type agnostic
- It uses `transformerFactory.transformToUnified(request, clientApiType)` which will call `GeminiTransformer.parseRequest()`
- The `getEndpointUrl()` already returns the correct Gemini endpoint URL
- The transformation pipeline handles Gemini → Unified → Provider transformations

### Phase 3: Add Server Route
**File:** `server.ts`

**Changes:**

Add new route in `Bun.serve({ routes: { ... } })` section (after `/v1/models`, before `/v0/config`):

```typescript
"/v1beta/models/:modelWithAction": {
  POST: async (req, server) => {
    const { clientIp, requestId } = getRequestContext(req, server);
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    // Expected format: /v1beta/models/:modelWithAction
    const modelWithAction = pathParts[3]; // Index 3 is after 'models/'
    
    return withCORS(
      await handleGemini(req, context, requestId, clientIp, modelWithAction)
    );
  },
}
```

**Import Statement:**
```typescript
import { handleGemini } from "./server/routes/gemini";
```

**Route Priority:**
- Place before the catch-all `"/*"` route to ensure it's matched
- After existing V1 routes for consistency

### Phase 4: Request Context & Usage Tracking
**File:** `server/routes/gemini.ts`

**Usage Logging Integration:**
The `RequestContext` object in the Dispatcher already tracks:
- `incomingModelAlias` - Set from the URL parameter (modelName)
- `clientApiType` - Will be "gemini"
- `streaming` - Auto-detected from action in URL

**Example:**
```typescript
// In handleGemini, before dispatching:
const modelName = modelWithAction.split(':')[0];
// This will be captured by dispatcher in requestContext:
// requestContext.incomingModelAlias = modelName (set by router.resolve)
```

### Phase 5: Validation & Error Handling
**File:** `server/routes/gemini.ts`

**Validation Steps:**
1. ✅ URL parameter extraction - Extract `modelWithAction` from route params
2. ✅ Model/action parsing - Split on `:` to get model name and action
3. ✅ Authentication - Use existing `validateAuthHeader()`
4. ⚠️ **Optional:** Gemini request schema validation
   - Could create `GeminiGenerateContentRequestSchema` in `server/types/gemini.ts`
   - Or rely on downstream provider validation
   - **Recommendation:** Start without strict validation, add if needed

**Error Scenarios:**
- Missing `:` in URL → Default to `generateContent` action
- Invalid model name → Will fail in Router.resolve()
- Invalid request body → Will fail in GeminiTransformer.parseRequest()

### Phase 6: Testing & Verification

**Test Cases:**

1. **Non-streaming request:**
   ```bash
   POST /v1beta/models/gemini-1.5-pro:generateContent
   Content-Type: application/json
   
   {
     "contents": [
       {"role": "user", "parts": [{"text": "Hello"}]}
     ]
   }
   ```

2. **Streaming request:**
   ```bash
   POST /v1beta/models/gemini-1.5-flash:streamGenerateContent
   Content-Type: application/json
   
   {
     "contents": [
       {"role": "user", "parts": [{"text": "Count to 10"}]}
     ]
   }
   ```

3. **Model with prefix:**
   ```bash
   POST /v1beta/models/models/gemini-1.5-pro:generateContent
   ```
   (GeminiTransformer.getEndpoint() handles this - line 90-93)

4. **Cross-provider routing:**
   - Request to `/v1beta/models/gpt-4:streamGenerateContent`
   - Should route to OpenAI if aliased
   - Transform: Gemini → Unified → OpenAI → Unified → Gemini (response)

## File Changes Summary

### New Files
1. ✨ `server/routes/gemini.ts` - New route handler
2. 📄 `server/types/gemini.ts` - (Optional) Gemini-specific types/schemas

### Modified Files
1. 📝 `server.ts` - Add route and import
2. 📝 `server/services/dispatcher.ts` - Add `dispatchGemini()` method
3. 📝 No changes needed to `transformer-factory.ts` - Already supports "gemini" ✅
4. 📝 No changes needed to `gemini.ts` transformer - Already complete ✅

## Implementation Order

1. **Step 1:** Create `server/routes/gemini.ts` with full handler logic
2. **Step 2:** Add `dispatchGemini()` to `server/services/dispatcher.ts`
3. **Step 3:** Add route to `server.ts` with imports
4. **Step 4:** Test non-streaming request
5. **Step 5:** Test streaming request
6. **Step 6:** Test cross-provider transformation
7. **Step 7:** Verify usage logging captures correct model names

## Key Design Decisions

### 1. URL-Based Streaming Detection
**Decision:** Parse action from URL to set `stream` flag
**Rationale:** Gemini API embeds streaming in the URL path, not the body
**Implementation:** Check if action includes "streamGenerateContent"

### 2. Model Injection
**Decision:** Extract model from URL and inject into request body
**Rationale:** 
- Gemini API has model in URL
- Internal unified format expects model in body
- Transformer expects `request.model` to be set

### 3. Minimal Validation
**Decision:** Skip Gemini-specific schema validation initially
**Rationale:**
- GeminiTransformer.parseRequest() already validates structure
- Provider will reject invalid requests
- Reduces complexity and maintenance burden
- Can add later if needed

### 4. Reuse Existing Dispatcher
**Decision:** Add new `dispatchGemini()` method instead of custom logic
**Rationale:**
- Consistent with existing `dispatchChatCompletion()` and `dispatchMessages()`
- Reuses all transformation pipeline logic
- Maintains unified usage logging
- Easier to maintain

## Potential Issues & Solutions

### Issue 1: URL Parsing
**Problem:** Bun's route params may not extract `:modelWithAction` correctly
**Solution:** Use URL parsing and split pathname manually if needed

### Issue 2: Model Prefix Handling
**Problem:** Gemini models can have `models/` prefix (e.g., `models/gemini-1.5-pro`)
**Solution:** GeminiTransformer.getEndpoint() already handles this (line 90-93) ✅

### Issue 3: Action Query Parameters
**Problem:** Streaming action includes `?alt=sse` (e.g., `streamGenerateContent?alt=sse`)
**Solution:** Extract action before `?` or ensure URL parsing preserves it

### Issue 4: Cross-Provider Transformation
**Problem:** Client sends Gemini format, routes to OpenAI provider
**Solution:** Already handled by transformation pipeline:
- Gemini → Unified (via GeminiTransformer.parseRequest)
- Unified → OpenAI (via OpenAITransformer.transformRequest)
- OpenAI → Unified (via OpenAITransformer.transformResponse)
- Unified → Gemini (via GeminiTransformer.formatResponse)

## Success Criteria

- ✅ `/v1beta/models/:modelWithAction` route accepts POST requests
- ✅ Model name extracted from URL and set in request
- ✅ Streaming auto-detected from `:streamGenerateContent` action
- ✅ Non-streaming requests work with `:generateContent` action
- ✅ Authentication validates correctly
- ✅ Request dispatched through transformation pipeline
- ✅ Usage logging captures incoming model alias from URL
- ✅ Cross-provider routing works (Gemini client → OpenAI provider)
- ✅ Error handling matches existing routes
- ✅ CORS headers applied correctly

## Future Enhancements

1. **Gemini Schema Validation:** Add strict Zod schema for Gemini requests
2. **Action Validation:** Validate that action is one of known Gemini actions
3. **Model Name Normalization:** Handle various model name formats
4. **Custom Gemini Errors:** Map Gemini-specific errors to Plexus errors
5. **Metrics:** Track Gemini endpoint usage separately

## References

- Gemini Transformer: `server/transformers/gemini.ts`
- Dispatcher: `server/services/dispatcher.ts`
- Transformer Factory: `server/services/transformer-factory.ts`
- Chat Completions Handler (reference): `server/routes/chat-completions.ts`
- Messages Handler (reference): `server/routes/messages.ts`
- Server Routes: `server.ts`

---

**Status:** 📋 **PLAN COMPLETE - READY FOR IMPLEMENTATION**

**Estimated Complexity:** Medium (3 files to modify, 1 new file)
**Estimated Time:** 1-2 hours
**Risk Level:** Low (well-isolated changes, existing transformers proven)
