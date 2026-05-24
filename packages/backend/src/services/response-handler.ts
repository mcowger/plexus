import { FastifyReply, FastifyRequest } from 'fastify';
import { UnifiedChatResponse } from '../types/unified';
import { Transformer } from '../types/transformer';
import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from '../utils/logger';
import { calculateCosts } from '../utils/calculate-costs';
import { TransformerFactory } from '../services/transformer-factory';
import { DebugLoggingInspector, UsageInspector } from './inspectors';
import { Readable } from 'stream';
import { DebugManager } from './debug-manager';
import { estimateKwhUsed } from './inference-energy';
import { applyProviderReportedCost, applyUsageCostDetails } from '../utils/provider-cost';
import { extractUsageCostDetails } from '../utils/usage-normalizer';
import { StallInspector, type StallConfig } from './inspectors/stall-inspector';
import { DEFAULT_GPU_PARAMS, DEFAULT_MODEL } from '@plexus/shared';
import type { GpuParams } from '@plexus/shared';
import { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { recordQuotaUsage } from '../services/quota/quota-middleware';
import { CooldownManager } from './cooldown-manager';
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
  apiType: 'chat' | 'messages' | 'gemini' | 'responses',
  shouldEstimateTokens: boolean = false,
  originalRequest?: any,
  quotaEnforcer?: QuotaEnforcer,
  keyName?: string,
  abortController?: AbortController,
  stallDetectionResult?: {
    stallInspector: StallInspector;
    addStallConfig: (providerOverrides: {
      stallTtfbMs?: number | null;
      stallTtfbBytes?: number | null;
      stallMinBps?: number | null;
      stallWindowMs?: number | null;
      stallGracePeriodMs?: number | null;
    }) => void;
  } | null
) {
  // Populate usage record with metadata from the dispatcher's selection
  usageRecord.selectedModelName = unifiedResponse.plexus?.model || unifiedResponse.model; // Fallback to unifiedResponse.model if plexus.model is missing
  usageRecord.provider = unifiedResponse.plexus?.provider || 'unknown';
  usageRecord.canonicalModelName = unifiedResponse.plexus?.canonicalModel || null;

  // Set provider info for debug logging filter
  if (usageRecord.provider) {
    DebugManager.getInstance().setProviderForRequest(usageRecord.requestId!, usageRecord.provider);
  }
  usageRecord.attemptCount = unifiedResponse.plexus?.attemptCount || 1;
  usageRecord.retryHistory = unifiedResponse.plexus?.retryHistory || null;
  usageRecord.finalAttemptProvider =
    unifiedResponse.plexus?.finalAttemptProvider || usageRecord.provider || null;
  usageRecord.finalAttemptModel =
    unifiedResponse.plexus?.finalAttemptModel || usageRecord.selectedModelName || null;
  usageRecord.allAttemptedProviders =
    unifiedResponse.plexus?.allAttemptedProviders ||
    JSON.stringify([
      `${usageRecord.provider || 'unknown'}/${usageRecord.selectedModelName || unifiedResponse.model}`,
    ]);

  let outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();
  usageRecord.outgoingApiType = outgoingApiType?.toLocaleLowerCase();
  usageRecord.isStreamed = !!unifiedResponse.stream;
  usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

  // Always return Plexus request ID so callers can trace the full story
  reply.header('x-request-id', usageRecord.requestId!);

  const pricing = unifiedResponse.plexus?.pricing;
  const providerDiscount = unifiedResponse.plexus?.providerDiscount;
  // Normalize the provider API type to our supported internal constants: 'chat', 'messages', 'gemini'
  const providerApiType = (unifiedResponse.plexus?.apiType || 'chat').toLowerCase();

  // Enable ephemeral debug capture if token estimation is needed
  const debugManager = DebugManager.getInstance();
  const wasDebugEnabled = debugManager.isEnabled();

  if (shouldEstimateTokens) {
    debugManager.markEphemeral(usageRecord.requestId!);
    // Temporarily enable debug mode for this request if not already enabled
    if (!wasDebugEnabled) {
      debugManager.setEnabled(true);
    }
  }

  // --- Scenario A: Streaming Response ---
  if (unifiedResponse.stream) {
    let finalClientStream: ReadableStream;
    let rawStream = unifiedResponse.stream;

    // TAP THE RAW STREAM for debugging/usage extraction
    // We always capture the stream BEFORE any transformation to enable usage extraction,
    // even with pass-through optimization. Debug mode only controls DB persistence.
    const rawLogInspector = new DebugLoggingInspector(
      usageRecord.requestId!,
      'raw'
    ).createInspector(providerApiType);

    const tapStream = new TransformStream({
      transform(chunk, controller) {
        rawLogInspector.write(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        rawLogInspector.end();
      },
    });

    rawStream = rawStream.pipeThrough(tapStream);

    if (unifiedResponse.bypassTransformation) {
      // Direct pass-through: No changes to the provider's raw bytes
      // Maximize performance and accuracy by avoiding unnecessary transformations
      finalClientStream = rawStream;
    } else {
      /**
       * Transformation Pipeline:
       * 1. providerTransformer.transformStream: Provider SSE (e.g. OpenAI) -> Unified internal chunks
       * 2. clientTransformer.formatStream: Unified internal chunks -> Client SSE format (e.g. Anthropic)
       */
      // Get the transformer for the outgoing provider's format
      const providerTransformer = TransformerFactory.getTransformer(providerApiType);

      // Step 1: Raw Provider SSE -> Unified internal objects
      const unifiedStream = providerTransformer.transformStream
        ? providerTransformer.transformStream(rawStream)
        : rawStream;

      // Step 2: Unified internal objects -> Client SSE format
      finalClientStream = clientTransformer.formatStream
        ? clientTransformer.formatStream(unifiedStream)
        : unifiedStream;
    }

    // TAP THE TRANSFORMED STREAM for debugging
    // This captures what is actually sent to the client
    const transformedLogInspector = new DebugLoggingInspector(
      usageRecord.requestId!,
      'transformed'
    ).createInspector(apiType);

    const transformedTapStream = new TransformStream({
      transform(chunk, controller) {
        transformedLogInspector.write(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        transformedLogInspector.end();
      },
    });

    finalClientStream = finalClientStream.pipeThrough(transformedTapStream);

    // Standard SSE headers to prevent buffering and timeouts
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');

    /**
     * Build the linear stream pipeline.
     */

    const usageInspector = new UsageInspector(
      usageRecord.requestId!,
      usageStorage,
      usageRecord,
      pricing,
      providerDiscount,
      startTime,
      shouldEstimateTokens,
      providerApiType,
      apiType,
      originalRequest,
      unifiedResponse.plexus?.gpuParams ?? DEFAULT_GPU_PARAMS,
      unifiedResponse.plexus?.modelParams ?? DEFAULT_MODEL,
      quotaEnforcer,
      keyName
    );

    // Convert Web Stream to Node Stream for piping
    const nodeStream = Readable.fromWeb(finalClientStream as any);

    // Insert StallInspector into the pipeline if stall detection is active
    const stallInspector = stallDetectionResult?.stallInspector ?? null;
    if (stallInspector) {
      stallInspector.setRequestId(usageRecord.requestId!);
      usageStorage.registerInFlight(
        usageRecord.requestId!,
        stallInspector,
        (usageRecord.apiKey as string | null) ?? null
      );
    }

    // Pipeline: Source -> StallInspector (if active) -> Usage -> Client
    const pipeline = stallInspector
      ? nodeStream.pipe(stallInspector).pipe(usageInspector)
      : nodeStream.pipe(usageInspector);

    // =============================================================================
    // CLIENT DISCONNECT DETECTION & UPSTREAM CANCELLATION
    // =============================================================================
    //
    // BACKGROUND — WHY THIS IS HARD ON BUN
    // -------------------------------------
    // Detecting client disconnects in Bun's node:http compatibility layer (which
    // Fastify uses) is deeply broken for streaming POST responses as of Bun 1.3.14.
    // We investigated every standard Node.js mechanism exhaustively:
    //
    //   ✗  request.raw.once('close', ...)  — fires immediately when the POST body
    //        is consumed (a few ms after the request arrives), NOT on client disconnect.
    //        Fastify's own onRequestAbort hook uses this + req.aborted, which is why
    //        Fastify's abort detection also doesn't work here.
    //
    //   ✗  socket.once('close', ...)  — never fires at all for POST requests when
    //        the client disconnects. (Bun open issue #14697: ServerResponse doesn't
    //        emit close event.)
    //
    //   ✗  socket.destroyed  — stays false indefinitely even after the client is gone.
    //
    //   ✗  res.write() EPIPE  — Bun silently swallows write failures; writes appear
    //        to succeed even when the client TCP connection is long dead. No EPIPE,
    //        no ECONNRESET, nothing. (Confirmed in Bun issue #25919, still reproducible
    //        on Bun 1.3.14 for the streaming proxy case.)
    //
    //   ✗  reply.raw.destroyed  — undefined (property doesn't exist on Bun's
    //        ServerResponse implementation).
    //
    // For reference, Bun.serve() (the native HTTP server) DOES correctly fire
    // request.signal abort on disconnect. But Fastify runs on node:http, not
    // Bun.serve(), so we can't use that here without a much larger refactor.
    //
    // THE SOLUTION — bunHandle.closed
    // --------------------------------
    // Bun's Node.js Socket wraps an internal Bun TCP socket handle. It is stored
    // under Symbol(handle) on the Socket object. This handle has a .closed boolean
    // property that transitions false → true when the underlying TCP connection
    // closes, even when all the Node.js-layer signals above are broken.
    //
    // Discovery: we enumerated Object.getOwnPropertySymbols() on the Socket at
    // runtime, found Symbol(handle), and verified with polling tests that its
    // .closed property updates correctly within ~250ms of a client disconnect.
    //
    // If Bun ever fixes the node:http disconnect signals, we can simplify this.
    // Track: https://github.com/oven-sh/bun/issues/25919
    //        https://github.com/oven-sh/bun/issues/14697
    //
    // CANCELLATION CHAIN — WHY nodeStream.destroy() IS REQUIRED
    // -----------------------------------------------------------
    // The stream pipeline is:
    //
    //   fetch response body  (Web ReadableStream)
    //       ↓  Readable.fromWeb()
    //   nodeStream           (Node.js Readable)
    //       ↓  .pipe()
    //   pipeline / usageInspector  (Node.js Transform/Writable)
    //       ↓  reply.send()
    //   HTTP response to client
    //
    // When a client disconnects, we need to cancel the upstream fetch so we stop
    // consuming tokens and burning API quota. Simply calling pipeline.destroy()
    // (the downstream end) does NOT propagate cancel() back through Readable.fromWeb()
    // to the underlying Web ReadableStream — the upstream fetch keeps running.
    //
    // Calling nodeStream.destroy() (the source Node Readable) DOES cause
    // Readable.fromWeb() to call cancel() on the Web ReadableStream, which aborts
    // the underlying fetch. We verified this with isolated test scripts.
    //
    // We also call abortController.abort() as belt-and-suspenders, since the fetch
    // was initiated with that signal.
    //
    // TIMEOUT ABORTS HAVE THE SAME BUG
    // ---------------------------------
    // abortController.abort() alone (whether triggered by a timeout or anything else)
    // also does NOT stop an already-in-progress Readable.fromWeb() read loop. The
    // abort signal is consumed by fetch() at call time; aborting it afterwards has
    // no effect on the streaming body read. nodeStream.destroy() is required in all
    // cases. We wire abortController.signal's 'abort' event to onDisconnect() so
    // that any future timeout wiring (e.g. AbortSignal.any([signal, AbortSignal.timeout(ms)]))
    // at the route level will automatically flow through the correct cancellation path
    // with no further changes needed here. See test-timeout-*.ts.
    // =============================================================================
    let disconnected = false;
    let disconnectPoll: ReturnType<typeof setInterval> | null = null;

    const rawSocket = (request.raw as any)?.socket;
    const symHandle = rawSocket
      ? Object.getOwnPropertySymbols(rawSocket).find((s) => s.toString() === 'Symbol(handle)')
      : undefined;
    const bunHandle = symHandle ? (rawSocket as any)[symHandle] : null;

    const onDisconnect = (source: string) => {
      if (disconnected) return;
      disconnected = true;
      // Determine if this is a timeout by checking the source string OR the abort
      // reason. When wireUpstreamTimeout fires, it calls abortController.abort(TimeoutError),
      // so the signal listener fires with source='signal.abort' but the reason tells us
      // it was a timeout.
      const isTimeout =
        source.includes('timeout') || abortController?.signal?.reason?.name === 'TimeoutError';
      // Stall detection uses DOMException('TimeoutError') as the abort reason,
      // but we check the reason message for 'stalled' to distinguish from absolute timeout.
      const isStall =
        source === 'stall' ||
        (abortController?.signal?.reason?.name === 'TimeoutError' &&
          abortController?.signal?.reason?.message?.includes('stalled'));
      logger.debug(
        `${isStall ? 'Stream stalled' : isTimeout ? 'Upstream timeout' : 'Client disconnected'} for request ${usageRecord.requestId} (detected via ${source}), aborting upstream`
      );
      const timeoutErr = isStall
        ? new DOMException(
            abortController?.signal?.reason?.message || 'Stream stalled',
            'TimeoutError'
          )
        : isTimeout
          ? new DOMException('The operation timed out.', 'TimeoutError')
          : undefined;
      abortController?.abort(timeoutErr);
      // Set responseStatus before destroy so UsageInspector._destroy() sees it.
      if (isStall) {
        usageRecord.responseStatus = 'stall';
        if (usageRecord.provider && usageRecord.selectedModelName) {
          CooldownManager.getInstance().markProviderStallFailure(
            usageRecord.provider,
            usageRecord.selectedModelName,
            abortController?.signal?.reason?.message || 'Stream stalled'
          );
        }
      } else if (isTimeout) {
        usageRecord.responseStatus = 'timeout';
      }
      // Destroy without passing the error — calling .destroy(err) causes Node.js to
      // emit 'error' on the stream, which becomes an uncaught exception since
      // these streams don't have error listeners. The cancellation still works:
      // nodeStream.destroy() triggers Readable.fromWeb → cancel() on the upstream
      // fetch body, and _destroy reads the status we already set on usageRecord.
      nodeStream.destroy(); // cancels the upstream fetch via Readable.fromWeb → cancel()
      pipeline.destroy();
    };

    if (abortController) {
      // Wire the abort signal so that timeout aborts also trigger
      // nodeStream.destroy(). abortController.abort() alone does NOT stop an
      // already-in-progress Readable.fromWeb() read loop — the same root cause as
      // the client-disconnect bug. This listener ensures any abort reason goes through
      // the correct cancellation path. The timeout is wired via wireUpstreamTimeout()
      // in the route handler, which calls abortController.abort() when the timeout
      // fires so this listener detects it. The pipeline.on('error') handler also
      // catches TimeoutErrors that propagate through the stream as a belt-and-suspenders.
      // See test-timeout-signal-listener.ts and utils/timeout.ts.
      abortController.signal.addEventListener('abort', () => onDisconnect('signal.abort'), {
        once: true,
      });

      // Poll bunHandle.closed every 250ms — the only reliable client-disconnect
      // signal available in Bun's node:http layer for POST requests (see above).
      disconnectPoll = setInterval(() => {
        if (bunHandle?.closed) onDisconnect('bunHandle.closed');
        if (pipeline.destroyed || pipeline.readableEnded) {
          if (disconnectPoll) {
            clearInterval(disconnectPoll);
            disconnectPoll = null;
          }
        }
      }, 250);
    }

    const cleanupDisconnectWiring = () => {
      if (disconnectPoll) {
        clearInterval(disconnectPoll);
        disconnectPoll = null;
      }
      if (stallInspector) {
        usageStorage.deregisterInFlight(usageRecord.requestId!);
      }
    };

    pipeline.once('end', cleanupDisconnectWiring);

    pipeline.on('error', (err: any) => {
      // Belt-and-suspenders: catch any write errors that do surface (e.g. if Bun
      // ever fixes EPIPE propagation, or on non-Bun runtimes).
      const code = err?.code;
      const isTimeout =
        err?.name === 'TimeoutError' ||
        err?.name === 'AbortError' ||
        err?.message?.includes('timeout') ||
        err?.message?.includes('aborted');
      if (
        code === 'EPIPE' ||
        code === 'ECONNRESET' ||
        code === 'ERR_STREAM_DESTROYED' ||
        isTimeout
      ) {
        onDisconnect(isTimeout ? 'pipeline.error.timeout' : 'pipeline.error.' + code);
      }
      cleanupDisconnectWiring(); // also deregisters stallInspector
      // Restore debug mode on error
      if (shouldEstimateTokens && !wasDebugEnabled) {
        debugManager.setEnabled(false);
      }
    });

    // Restore debug mode on normal end
    if (shouldEstimateTokens && !wasDebugEnabled) {
      pipeline.on('end', () => {
        debugManager.setEnabled(false);
      });
    }
    // --- end disconnect wiring ---

    usageRecord.responseStatus = 'success';

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
    DebugManager.getInstance().flush(usageRecord.requestId!);

    // Record the usage.
    finalizeUsage(
      usageRecord,
      unifiedResponse,
      usageStorage,
      startTime,
      pricing,
      providerDiscount,
      quotaEnforcer,
      keyName
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
async function finalizeUsage(
  usageRecord: Partial<UsageRecord>,
  unifiedResponse: UnifiedChatResponse,
  usageStorage: UsageStorageService,
  startTime: number,
  pricing: any,
  providerDiscount: any,
  quotaEnforcer?: QuotaEnforcer,
  keyName?: string
) {
  // Capture token usage if available in the response
  if (unifiedResponse.usage) {
    usageRecord.tokensInput = unifiedResponse.usage.input_tokens;
    usageRecord.tokensOutput = unifiedResponse.usage.output_tokens;
    usageRecord.tokensCached = unifiedResponse.usage.cached_tokens;
    usageRecord.tokensCacheWrite = unifiedResponse.usage.cache_creation_tokens;
    usageRecord.tokensReasoning = unifiedResponse.usage.reasoning_tokens;
  }

  // Capture response metadata
  usageRecord.toolCallsCount = unifiedResponse.tool_calls?.length ?? null;
  usageRecord.finishReason = unifiedResponse.finishReason ?? null;

  // Finalize costs and duration
  calculateCosts(usageRecord, pricing, providerDiscount);

  // Override with provider-reported cost if available in the raw response
  // (e.g. from SSE `: cost` comments or provider response payloads)
  const debugManager = DebugManager.getInstance();
  const reconstructed = debugManager.getReconstructedRawResponse(usageRecord.requestId!);
  if (reconstructed?.providerReportedCost) {
    applyProviderReportedCost(usageRecord, reconstructed.providerReportedCost);
    if (reconstructed?.usage) {
      const usageCostDetails = extractUsageCostDetails(reconstructed.usage);
      if (usageCostDetails) {
        logger.debug(
          `[ProviderCost] Both SSE :cost and usage.cost_details present for ${usageRecord.requestId}; ` +
            `SSE value ($${usageRecord.providerReportedCost}) takes priority over cost_details total ($${usageCostDetails.total_cost})`
        );
      }
    }
  }

  // Also check for cost_details in the usage block (some providers embed costs there)
  if (!usageRecord.providerReportedCost && reconstructed?.usage) {
    const usageCostDetails = extractUsageCostDetails(reconstructed.usage);
    if (usageCostDetails) {
      applyUsageCostDetails(usageRecord, usageCostDetails);
    }
  }
  usageRecord.responseStatus = 'success';
  usageRecord.durationMs = Date.now() - startTime;

  // Populate performance metrics
  const outputTokens = usageRecord.tokensOutput || 0;
  const reasoningTokens = usageRecord.tokensReasoning || 0;
  const totalOutputTokens = outputTokens + reasoningTokens;
  usageRecord.ttftMs = usageRecord.durationMs; // For unary, TTFT equals full duration
  if (totalOutputTokens > 0 && usageRecord.durationMs > 0) {
    usageRecord.tokensPerSec = (totalOutputTokens / usageRecord.durationMs) * 1000;
  }

  // Use provider-reported energy if available, otherwise estimate
  // Some providers emit `: energy {"energy_kwh": ...}` as SSE comments
  if (reconstructed?.providerReportedEnergy?.energy_kwh != null) {
    const energyKwh = Number(reconstructed.providerReportedEnergy.energy_kwh);
    if (!isNaN(energyKwh) && energyKwh >= 0) {
      usageRecord.kwhUsed = Number(energyKwh.toFixed(10));
    }
  } else {
    // Estimate energy consumption using resolved GPU and model params from dispatcher
    const plexusGpuParams = unifiedResponse.plexus?.gpuParams ?? DEFAULT_GPU_PARAMS;
    const plexusModelParams = unifiedResponse.plexus?.modelParams ?? DEFAULT_MODEL;
    usageRecord.kwhUsed = estimateKwhUsed(
      usageRecord.tokensInput ?? 0,
      usageRecord.tokensOutput ?? 0,
      plexusModelParams,
      plexusGpuParams
    );
  }

  // Persist usage record to database
  await usageStorage.saveRequest(usageRecord as UsageRecord);

  // Update the performance sliding window for future routing decisions
  if (usageRecord.provider && usageRecord.selectedModelName) {
    await usageStorage.updatePerformanceMetrics(
      usageRecord.provider,
      usageRecord.selectedModelName,
      usageRecord.canonicalModelName ?? null,
      usageRecord.durationMs,
      totalOutputTokens > 0 ? totalOutputTokens : null,
      usageRecord.durationMs,
      usageRecord.requestId!
    );
  }

  // Record quota usage after costs are calculated
  if (quotaEnforcer && keyName) {
    await recordQuotaUsage(
      keyName,
      {
        tokensInput: usageRecord.tokensInput,
        tokensOutput: usageRecord.tokensOutput,
        tokensCached: usageRecord.tokensCached,
        tokensCacheWrite: usageRecord.tokensCacheWrite,
        tokensReasoning: usageRecord.tokensReasoning,
        costTotal: usageRecord.costTotal,
      },
      quotaEnforcer
    );
  }
}
