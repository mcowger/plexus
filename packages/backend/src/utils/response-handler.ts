import { FastifyReply } from "fastify";
import { UnifiedChatResponse } from "../types/unified";
import { Transformer } from "../types/transformer";
import { UsageRecord } from "../types/usage";
import { UsageStorageService } from "../services/usage-storage";
import { logger } from "./logger";
import { calculateCosts } from "./calculate-costs";
import { TransformerFactory } from "../services/transformer-factory";

/**
 * handleResponse
 * 
 * Core utility for finalizing LLM responses.
 * 1. Updates usage records with provider and model info.
 * 2. Handles either Streaming (via TransformStream) or Unary (JSON) responses.
 * 3. Calculates costs and saves records to the database.
 */
export async function handleResponse(
  reply: FastifyReply,
  unifiedResponse: UnifiedChatResponse,
  clientTransformer: Transformer,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  startTime: number,
  apiType: "chat" | "messages" | "gemini"
) {
  // Populate usage record with metadata from the dispatcher's selection
  usageRecord.selectedModelName = unifiedResponse.plexus?.model || unifiedResponse.model;
  usageRecord.provider = unifiedResponse.plexus?.provider;

  let outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();
  usageRecord.outgoingApiType = outgoingApiType;
  usageRecord.isStreamed = !!unifiedResponse.stream;
  usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

  const pricing = unifiedResponse.plexus?.pricing;
  const providerDiscount = unifiedResponse.plexus?.providerDiscount;

  // --- Scenario A: Streaming Response ---
  if (unifiedResponse.stream) {
    let finalClientStream: ReadableStream;

    if (unifiedResponse.bypassTransformation) {
      // Direct pass-through: No changes to the provider's raw bytes
      finalClientStream = unifiedResponse.stream;
    } else {
      /**
       * Transformation Pipeline:
       * 1. providerTransformer.transformStream: Provider SSE (e.g. OpenAI) -> Unified internal chunks
       * 2. clientTransformer.formatStream: Unified internal chunks -> Client SSE format (e.g. Anthropic)
       */
      
      // Normalize the provider API type to our supported internal constants: 'chat', 'messages', 'gemini'
      let providerApiType = (unifiedResponse.plexus?.apiType || "chat").toLowerCase();
      if (providerApiType === 'openai') providerApiType = 'chat';
      if (providerApiType === 'anthropic') providerApiType = 'messages';
      if (providerApiType === 'google') providerApiType = 'gemini';

      // Get the transformer for the outgoing provider's format
      const providerTransformer = TransformerFactory.getTransformer(providerApiType);

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

    usageRecord.responseStatus = "success";

    // Fastify natively supports sending ReadableStream as the response body
    return reply.send(finalClientStream);

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

    logger.debug(`Outgoing ${apiType} Response`, responseBody);
    return reply.send(responseBody);
  }
}