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
 * Populates usage record with metadata from the unified response
 */
function populateUsageMetadata(
  usageRecord: Partial<UsageRecord>,
  unifiedResponse: UnifiedChatResponse
): { pricing: any; providerDiscount: any; providerApiType: string } {
  usageRecord.selectedModelName =
    unifiedResponse.plexus?.model || unifiedResponse.model;
  usageRecord.provider = unifiedResponse.plexus?.provider || "unknown";
  usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel || null;

  const outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();
  usageRecord.outgoingApiType = outgoingApiType?.toLocaleLowerCase();
  usageRecord.isStreamed = !!unifiedResponse.stream;
  usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

  const pricing = unifiedResponse.plexus?.pricing;
  const providerDiscount = unifiedResponse.plexus?.providerDiscount;
  const providerApiType = (unifiedResponse.plexus?.apiType || "chat").toLowerCase();

  return { pricing, providerDiscount, providerApiType };
}

/**
 * Creates a transform stream that taps into the stream for debugging purposes
 */
function createStreamTap(
  requestId: string,
  logType: 'raw' | 'transformed',
  apiType: string
): { tapStream: TransformStream; inspector: NodeJS.WritableStream } {
  const inspector = new DebugLoggingInspector(requestId, logType).createInspector(apiType);

  const tapStream = new TransformStream({
    transform(chunk, controller) {
      inspector.write(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      inspector.end();
    }
  });

  return { tapStream, inspector };
}

/**
 * Builds the transformation pipeline for streaming responses
 */
function buildTransformationPipeline(
  rawStream: ReadableStream,
  unifiedResponse: UnifiedChatResponse,
  clientTransformer: Transformer,
  providerApiType: string
): ReadableStream {
  if (unifiedResponse.bypassTransformation) {
    return rawStream;
  }

  // Get the transformer for the outgoing provider's format
  const providerTransformer = TransformerFactory.getTransformer(providerApiType);

  // Step 1: Raw Provider SSE -> Unified internal objects
  const unifiedStream = providerTransformer.transformStream
    ? providerTransformer.transformStream(rawStream)
    : rawStream;

  // Step 2: Unified internal objects -> Client SSE format
  return clientTransformer.formatStream
    ? clientTransformer.formatStream(unifiedStream)
    : unifiedStream;
}

/**
 * Sets up SSE headers for streaming responses
 */
function setupStreamingHeaders(reply: FastifyReply): void {
  reply.header("Content-Type", "text/event-stream");
  reply.header("Cache-Control", "no-cache");
  reply.header("Connection", "keep-alive");
}

/**
 * Handles streaming responses
 */
async function handleStreamingResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  unifiedResponse: UnifiedChatResponse,
  clientTransformer: Transformer,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  startTime: number,
  apiType: "chat" | "messages" | "gemini",
  pricing: any,
  providerDiscount: any,
  providerApiType: string
): Promise<FastifyReply> {
  let rawStream = unifiedResponse.stream!;

  // Tap the raw stream for debugging
  const { tapStream: rawTap } = createStreamTap(
    usageRecord.requestId!,
    'raw',
    providerApiType
  );
  rawStream = rawStream.pipeThrough(rawTap);

  // Build transformation pipeline
  let finalClientStream = buildTransformationPipeline(
    rawStream,
    unifiedResponse,
    clientTransformer,
    providerApiType
  );

  // Tap the transformed stream for debugging
  const streamApiType = unifiedResponse.bypassTransformation ? providerApiType : apiType;
  const { tapStream: transformedTap } = createStreamTap(
    usageRecord.requestId!,
    'transformed',
    apiType
  );
  finalClientStream = finalClientStream.pipeThrough(transformedTap);

  // Set up SSE headers
  setupStreamingHeaders(reply);

  // Create usage inspector
  const usageInspector = new UsageInspector(
    usageRecord.requestId!,
    usageStorage,
    usageRecord,
    pricing,
    providerDiscount,
    startTime
  ).createInspector(streamApiType);

  // Convert Web Stream to Node Stream and pipe through inspector
  const nodeStream = Readable.fromWeb(finalClientStream as any);
  const pipeline = nodeStream.pipe(usageInspector);

  usageRecord.responseStatus = "success";

  return reply.send(pipeline);
}

/**
 * Handles unary (non-streaming) responses
 */
async function handleUnaryResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  unifiedResponse: UnifiedChatResponse,
  clientTransformer: Transformer,
  usageRecord: Partial<UsageRecord>,
  usageStorage: UsageStorageService,
  startTime: number,
  apiType: "chat" | "messages" | "gemini",
  pricing: any,
  providerDiscount: any
): Promise<FastifyReply> {
  // Remove internal plexus metadata before sending to client
  if (unifiedResponse.plexus) {
    delete (unifiedResponse as any).plexus;
  }

  // Determine response body
  let responseBody;
  if (unifiedResponse.bypassTransformation && unifiedResponse.rawResponse) {
    responseBody = unifiedResponse.rawResponse;
  } else {
    responseBody = await clientTransformer.formatResponse(unifiedResponse);
  }

  // Capture transformed response for debugging
  DebugManager.getInstance().addTransformedResponse(usageRecord.requestId!, responseBody);
  DebugManager.getInstance().flush(usageRecord.requestId!);

  // Record the usage
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
  // Populate usage record with metadata
  const { pricing, providerDiscount, providerApiType } = populateUsageMetadata(
    usageRecord,
    unifiedResponse
  );

  // Route to appropriate handler based on response type
  if (unifiedResponse.stream) {
    return handleStreamingResponse(
      request,
      reply,
      unifiedResponse,
      clientTransformer,
      usageRecord,
      usageStorage,
      startTime,
      apiType,
      pricing,
      providerDiscount,
      providerApiType
    );
  } else {
    return handleUnaryResponse(
      request,
      reply,
      unifiedResponse,
      clientTransformer,
      usageRecord,
      usageStorage,
      startTime,
      apiType,
      pricing,
      providerDiscount
    );
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
