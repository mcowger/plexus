import { Context } from "hono";
import { UnifiedChatResponse } from "../types/unified";
import { Transformer } from "../types/transformer";
import { UsageRecord } from "../types/usage";
import { UsageStorageService } from "../services/usage-storage";
import { logger } from "./logger";
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
   
    let clientStream = unifiedResponse.stream;

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
