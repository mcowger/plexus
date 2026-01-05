import { FastifyReply, FastifyRequest } from "fastify";
import { UnifiedChatResponse } from "../types/unified";
import { Transformer } from "../types/transformer";
import { UsageRecord } from "../types/usage";
import { UsageStorageService } from "../services/usage-storage";
import { logger } from "../utils/logger";
import { calculateCosts } from "../utils/calculate-costs";
import { TransformerFactory } from "../services/transformer-factory";
import { DebugLoggingInspector, UsageInspector } from "./inspectors";
import { Readable } from "stream";
import { DebugManager } from "./debug-manager";
/**
 * handleResponse
 *
 * Core utility for finalizing LLM responses.
 * 1. Updates usage records with provider and model info.
 * 2. Handles either Streaming (via TransformStream) or Unary (JSON) responses.
 * 3. Calculates costs and saves records to the database.
 * 4. Attaches inspectors for logging and usage analysis.
 */
export async function handleResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  unifiedResponse: UnifiedChatResponse,
  clientTransformer: Transformer,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  startTime: number,
  apiType: "chat" | "messages" | "gemini"
) {
  // Populate usage record with metadata from the dispatcher's selection
  usageRecord.selectedModelName =
    unifiedResponse.plexus?.model || unifiedResponse.model; // Fallback to unifiedResponse.model if plexus.model is missing
  usageRecord.provider = unifiedResponse.plexus?.provider || "unknown";

  let outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();
  usageRecord.outgoingApiType = outgoingApiType?.toLocaleLowerCase();
  usageRecord.isStreamed = !!unifiedResponse.stream;
  usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

  const pricing = unifiedResponse.plexus?.pricing;
  const providerDiscount = unifiedResponse.plexus?.providerDiscount;
  // Normalize the provider API type to our supported internal constants: 'chat', 'messages', 'gemini'
  const providerApiType = (unifiedResponse.plexus?.apiType || "chat").toLowerCase();

  // --- Scenario A: Streaming Response ---
  if (unifiedResponse.stream) {
    let finalClientStream: ReadableStream;

    if (unifiedResponse.bypassTransformation) {
      // Direct pass-through: No changes to the provider's raw bytes
      // Maximize performance and accuracy by avoiding unnecessary transformations
      finalClientStream = unifiedResponse.stream;
    } else {
      /**
       * Transformation Pipeline:
       * 1. providerTransformer.transformStream: Provider SSE (e.g. OpenAI) -> Unified internal chunks
       * 2. clientTransformer.formatStream: Unified internal chunks -> Client SSE format (e.g. Anthropic)
       */
      // Get the transformer for the outgoing provider's format
      const providerTransformer =
        TransformerFactory.getTransformer(providerApiType);

      // Step 1: Raw Provider SSE -> Unified internal objects
      const unifiedStream = providerTransformer.transformStream
        ? providerTransformer.transformStream(unifiedResponse.stream)
        : unifiedResponse.stream;

      // Step 2: Unified internal objects -> Client SSE format
      finalClientStream = clientTransformer.formatStream
        ? clientTransformer.formatStream(unifiedStream)
        : unifiedStream;
    }

    // Standard SSE headers to prevent buffering and timeouts
    reply.header("Content-Type", "text/event-stream");
    reply.header("Cache-Control", "no-cache");
    reply.header("Connection", "keep-alive");

    /**
     * Build the linear stream pipeline.
     * We avoid .tee() as it breaks backpressure and stability.
     * Instead, we use PassThrough streams ('inspectors') to 'tap' into the data.
     */
    const rawLogInspector = new DebugLoggingInspector(usageRecord.requestId!).createInspector(providerApiType);
    const usageInspector = new UsageInspector(usageRecord.requestId!).createInspector();

    // Convert Web Stream to Node Stream for piping
    const nodeStream = Readable.fromWeb(finalClientStream as any);

    // Pipeline: Source -> Raw Logger -> Usage -> Client
    const pipeline = nodeStream.pipe(rawLogInspector).pipe(usageInspector);

    usageRecord.responseStatus = "success";

    // Fastify natively supports sending ReadableStream as the response body
    return reply.send(pipeline);
  } else {
    // --- Scenario B: Non-Streaming (Unary) Response ---

    // Remove internal plexus metadata before sending to client
    if (unifiedResponse.plexus) {
      delete (unifiedResponse as any).plexus;
    }

    let responseBody;
    if (unifiedResponse.bypassTransformation && unifiedResponse.rawResponse) {
      responseBody = unifiedResponse.rawResponse;
    } else {
      // Re-format the unified JSON body to match the client's expected API format
      responseBody = await clientTransformer.formatResponse(unifiedResponse);
    }

    // Capture transformed response for debugging
    DebugManager.getInstance().addTransformedResponse(usageRecord.requestId!, responseBody);

    // Record the usage.
    finalizeUsage(
      usageRecord,
      unifiedResponse,
      usageStorage,
      startTime,
      pricing,
      providerDiscount
    );

    logger.debug(`Outgoing ${apiType} Response`, responseBody);
    return reply.send(responseBody);
  }
}

/**
 * finalizeUnaryUsage
 *
 * Helper to capture token usage, calculate costs, and persist usage records
 * specifically for non-streaming (unary) responses.
 */
function finalizeUsage(
  usageRecord: Partial<UsageRecord>,
  unifiedResponse: UnifiedChatResponse,
  usageStorage: UsageStorageService,
  startTime: number,
  pricing: any,
  providerDiscount: any
) {
  // Capture token usage if available in the response
  if (unifiedResponse.usage) {
    usageRecord.tokensInput = unifiedResponse.usage.input_tokens;
    usageRecord.tokensOutput = unifiedResponse.usage.output_tokens;
    usageRecord.tokensCached = unifiedResponse.usage.cached_tokens;
    usageRecord.tokensReasoning = unifiedResponse.usage.reasoning_tokens;
  }

  // Finalize costs and duration
  calculateCosts(usageRecord, pricing, providerDiscount);
  usageRecord.responseStatus = "success";
  usageRecord.durationMs = Date.now() - startTime;

  // Populate performance metrics
  const outputTokens = usageRecord.tokensOutput || 0;
  usageRecord.ttftMs = usageRecord.durationMs; // For unary, TTFT equals full duration
  if (outputTokens > 0 && usageRecord.durationMs > 0) {
    usageRecord.tokensPerSec = (outputTokens / usageRecord.durationMs) * 1000;
  }

  // Persist usage record to database
  usageStorage.saveRequest(usageRecord as UsageRecord);

  // Update the performance sliding window for future routing decisions
  if (usageRecord.provider && usageRecord.selectedModelName) {
    usageStorage.updatePerformanceMetrics(
      usageRecord.provider,
      usageRecord.selectedModelName,
      usageRecord.durationMs,
      outputTokens > 0 ? outputTokens : null,
      usageRecord.durationMs,
      usageRecord.requestId!
    );
  }
}
