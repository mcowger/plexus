import { Context } from "hono";
import { UnifiedChatResponse } from "../types/unified";
import { Transformer } from "../types/transformer";
import { UsageRecord } from "../types/usage";
import { UsageStorageService } from "../services/usage-storage";
import { logger } from "./logger";
import { DebugManager } from "../services/debug-manager";
import { createUsageObserver } from "./usage-observer";
import { observeStream } from "./stream-tap";
import { calculateCosts } from "./calculate-costs";

export async function handleResponse(
  c: Context,
  unifiedResponse: UnifiedChatResponse,
  transformer: Transformer,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  startTime: number,
  apiType: "chat" | "messages" | "gemini"
) {
  // Update record with selected model info if available
  usageRecord.selectedModelName =
    unifiedResponse.plexus?.model || unifiedResponse.model;
  usageRecord.provider = unifiedResponse.plexus?.provider;

  let outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();

  usageRecord.outgoingApiType = outgoingApiType;

  usageRecord.isStreamed = !!unifiedResponse.stream;
  usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

  const pricing = unifiedResponse.plexus?.pricing;
  const providerDiscount = unifiedResponse.plexus?.providerDiscount;

  // Is this a streaming response?
  if (unifiedResponse.stream) {
    // Create observer that handles all the parsing and processing
    const { observeAndProcess } = createUsageObserver(
      usageRecord,
      startTime,
      usageStorage,
      pricing,
      transformer,
      providerDiscount
    );

    // Split the raw stream: one for client, one for usage observation
    const { clientStream: clientStream1, usageStream } = observeStream(unifiedResponse.stream);

    // Start usage observation in background (fire-and-forget)
    observeAndProcess(usageStream);

    // Split again for debug capture if enabled
    let clientStream = clientStream1;
    if (usageRecord.requestId && DebugManager.getInstance().isEnabled()) {
      const { clientStream: clientStream2, usageStream: debugStream } = observeStream(clientStream1);
      clientStream = clientStream2;
      
      // Start debug capture in background (fire-and-forget)
      const captureRaw = DebugManager.getInstance().observeAndCapture(
        debugStream,
        usageRecord.requestId,
        'rawResponse'
      );
      captureRaw();
    }

    // Determine final client stream
    let finalClientStream: ReadableStream;
    if (unifiedResponse.bypassTransformation) {
      // Passthrough: send raw stream directly to client
      finalClientStream = clientStream;
    } else {
      // Normal: transform to unified, then format to client API
      const unifiedStream = transformer.transformStream
        ? transformer.transformStream(clientStream)
        : clientStream;
      
      finalClientStream = transformer.formatStream
        ? transformer.formatStream(unifiedStream)
        : unifiedStream;
      
      // Capture transformed response if debug enabled
      if (usageRecord.requestId && DebugManager.getInstance().isEnabled()) {
        const { clientStream: finalClient, usageStream: debugTransformed } = observeStream(finalClientStream);
        finalClientStream = finalClient;
        
        const captureTransformed = DebugManager.getInstance().observeAndCapture(
          debugTransformed,
          usageRecord.requestId,
          'transformedResponse'
        );
        captureTransformed();
      }
    }

    // Set headers and return the stream directly
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    usageRecord.responseStatus = "success";

    return new Response(finalClientStream, {
      headers: c.res.headers,
    });
  } else {
    // Non-streaming response

    // Strip plexus internal metadata
    if (unifiedResponse.plexus) {
      delete (unifiedResponse as any).plexus;
    }

    let responseBody;
    if (unifiedResponse.bypassTransformation && unifiedResponse.rawResponse) {
      responseBody = unifiedResponse.rawResponse;
    } else {
      responseBody = await transformer.formatResponse(unifiedResponse);
    }

    if (usageRecord.requestId) {
      DebugManager.getInstance().addTransformedResponse(
        usageRecord.requestId,
        responseBody
      );
      DebugManager.getInstance().flush(usageRecord.requestId);
    }

    // Populate usage stats
    if (unifiedResponse.usage) {
      usageRecord.tokensInput = unifiedResponse.usage.input_tokens;
      usageRecord.tokensOutput = unifiedResponse.usage.output_tokens;
      usageRecord.tokensCached = unifiedResponse.usage.cached_tokens;
      usageRecord.tokensReasoning = unifiedResponse.usage.reasoning_tokens;
    }

    calculateCosts(usageRecord, pricing, providerDiscount);
    usageRecord.responseStatus = "success";
    usageRecord.durationMs = Date.now() - startTime;

    // Performance metrics for non-streaming
    const outputTokens = usageRecord.tokensOutput || 0;
    usageRecord.ttftMs = usageRecord.durationMs; // TTFT = full duration for non-streaming
    if (outputTokens > 0 && usageRecord.durationMs > 0) {
      usageRecord.tokensPerSec = (outputTokens / usageRecord.durationMs) * 1000;
    }

    usageStorage.saveRequest(usageRecord as UsageRecord);

    // Update performance metrics for non-streaming requests
    if (usageRecord.provider && usageRecord.selectedModelName) {
      // For non-streaming, TTFT is approximately the full duration
      const outputTokens = usageRecord.tokensOutput || 0;
      usageStorage.updatePerformanceMetrics(
        usageRecord.provider,
        usageRecord.selectedModelName,
        usageRecord.durationMs, // TTFT = full duration for non-streaming
        outputTokens > 0 ? outputTokens : null,
        usageRecord.durationMs,
        usageRecord.requestId!
      );
    }

    logger.debug(`Outgoing ${apiType} Response`, responseBody);
    return c.json(responseBody);
  }
}
