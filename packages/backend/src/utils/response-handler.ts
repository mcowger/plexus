import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { UnifiedChatResponse } from '../types/unified';
import { Transformer } from '../types/transformer';
import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from './logger';
import { DebugManager } from '../services/debug-manager';
import { PricingManager } from '../services/pricing-manager';

function calculateCosts(usageRecord: Partial<UsageRecord>, pricing: any, providerDiscount?: number) {
    const inputTokens = usageRecord.tokensInput || 0;
    const outputTokens = usageRecord.tokensOutput || 0;
    const cachedTokens = usageRecord.tokensCached || 0;

    let inputCost = 0;
    let outputCost = 0;
    let cachedCost = 0;
    let calculated = false;

    // Default to 'default' source with 0-cost metadata
    usageRecord.costSource = 'default';
    usageRecord.costMetadata = JSON.stringify({ input: 0, output: 0, cached: 0 });

    if (!pricing) return;

    if (pricing.source === 'simple') {
        inputCost = (inputTokens / 1_000_000) * pricing.input;
        outputCost = (outputTokens / 1_000_000) * pricing.output;
        cachedCost = (cachedTokens / 1_000_000) * (pricing.cached || 0);
        calculated = true;
        
        usageRecord.costSource = 'simple';
        usageRecord.costMetadata = JSON.stringify(pricing);
    } else if (pricing.source === 'defined' && Array.isArray(pricing.range)) {
        const match = pricing.range.find((r: any) => {
            const lower = r.lower_bound ?? 0;
            const upper = r.upper_bound ?? Infinity;
            return inputTokens >= lower && inputTokens <= upper;
        });

        if (match) {
            inputCost = (inputTokens / 1_000_000) * match.input_per_m;
            outputCost = (outputTokens / 1_000_000) * match.output_per_m;
            calculated = true;
            
            usageRecord.costSource = 'defined';
            usageRecord.costMetadata = JSON.stringify({
                source: 'defined',
                input: match.input_per_m,
                output: match.output_per_m,
                range: match
            });
        }
    } else if (pricing.source === 'openrouter' && pricing.slug) {
        const openRouterPricing = PricingManager.getInstance().getPricing(pricing.slug);
        if (openRouterPricing) {
            // OpenRouter pricing is per token (strings)
            const promptRate = parseFloat(openRouterPricing.prompt) || 0;
            const completionRate = parseFloat(openRouterPricing.completion) || 0;
            const cacheReadRate = parseFloat(openRouterPricing.input_cache_read || '0') || 0;

            inputCost = inputTokens * promptRate;
            outputCost = outputTokens * completionRate;
            cachedCost = cachedTokens * cacheReadRate;

            const effectiveDiscount = pricing.discount ?? providerDiscount;

            if (effectiveDiscount) {
                const multiplier = 1 - effectiveDiscount;
                inputCost *= multiplier;
                outputCost *= multiplier;
                cachedCost *= multiplier;
            }

            calculated = true;
            
            usageRecord.costSource = 'openrouter';
            usageRecord.costMetadata = JSON.stringify({
                slug: pricing.slug,
                prompt: promptRate,
                completion: completionRate,
                input_cache_read: cacheReadRate,
                discount: effectiveDiscount
            });
        }
    }

    if (calculated) {
        usageRecord.costInput = Number(inputCost.toFixed(8));
        usageRecord.costOutput = Number(outputCost.toFixed(8));
        usageRecord.costCached = Number(cachedCost.toFixed(8));
        usageRecord.costTotal = Number((inputCost + outputCost + cachedCost).toFixed(8));
    }
}

export async function handleResponse(
    c: Context,
    unifiedResponse: UnifiedChatResponse,
    transformer: Transformer,
    usageRecord: Partial<UsageRecord>,
    usageStorage: UsageStorageService,
    startTime: number,
    apiType: 'chat' | 'messages' | 'gemini'
) {
    // Update record with selected model info if available
    usageRecord.selectedModelName = unifiedResponse.plexus?.model || unifiedResponse.model;
    usageRecord.provider = unifiedResponse.plexus?.provider;
    
    let outgoingApiType = unifiedResponse.plexus?.apiType?.toLowerCase();
    
    usageRecord.outgoingApiType = outgoingApiType;
    
    usageRecord.isStreamed = !!unifiedResponse.stream;
    usageRecord.isPassthrough = unifiedResponse.bypassTransformation;

    const pricing = unifiedResponse.plexus?.pricing;
    const providerDiscount = unifiedResponse.plexus?.providerDiscount;

    if (unifiedResponse.stream) {
        let finalClientStream: ReadableStream;
        let timeToFirstToken: number | null = null;
        let firstChunkReceived = false;

        if (unifiedResponse.bypassTransformation && unifiedResponse.rawStream) {
            // --- Case 1: Passthrough ---
            // Client receives the raw stream directly.
            finalClientStream = unifiedResponse.rawStream;

            // We MUST drain unifiedResponse.stream to capture usage stats and prevent upstream backpressure
            // (since it likely shares a source with rawStream).
            (async () => {
                const reader = unifiedResponse.stream!.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        // Capture TTFT on first chunk
                        if (!firstChunkReceived) {
                            timeToFirstToken = Date.now() - startTime;
                            firstChunkReceived = true;
                        }
                        
                        if (value && value.usage) {
                            usageRecord.tokensInput = value.usage.input_tokens;
                            usageRecord.tokensOutput = value.usage.output_tokens;
                            usageRecord.tokensCached = value.usage.cached_tokens;
                            usageRecord.tokensReasoning = value.usage.reasoning_tokens;
                        }
                    }
                    // Success state is set by the main stream handler to ensure sync with client download
                } catch (e: any) {
                    logger.error(`Usage tracking stream error (passthrough) for request ${usageRecord.requestId}: ${e.message}`);
                    usageStorage.saveError(usageRecord.requestId!, e, { phase: 'usage_tracking_passthrough' });
                }
                // We do NOT save the record here for passthrough; the main stream handler does it 
                // to ensure we capture the full duration of the client download.
            })();

        } else {
            // --- Case 2: Transformation (Normal) ---
            // We inject an observer into the stream to track usage as it flows to the client.
            // This ensures we don't race the client or create unread branches.
            const usageObserver = new TransformStream({
                transform(chunk, controller) {
                    controller.enqueue(chunk);
                    
                    // Capture TTFT on first chunk
                    if (!firstChunkReceived) {
                        timeToFirstToken = Date.now() - startTime;
                        firstChunkReceived = true;
                    }
                    
                    try {
                        if (chunk && chunk.usage) {
                            usageRecord.tokensInput = chunk.usage.input_tokens;
                            usageRecord.tokensOutput = chunk.usage.output_tokens;
                            usageRecord.tokensCached = chunk.usage.cached_tokens;
                            usageRecord.tokensReasoning = chunk.usage.reasoning_tokens;
                        }
                    }
                    catch (e: any) {
                        // Ignore parsing errors in observer to protect the stream
                    }
                }
            });

            // Pipe source through observer -> this becomes the new source
            const observedStream = unifiedResponse.stream.pipeThrough(usageObserver);

            finalClientStream = transformer.formatStream ? 
                               transformer.formatStream(observedStream) : 
                               observedStream;
        }

        return stream(c, async (stream) => {
            c.header('Content-Type', 'text/event-stream');
            c.header('Cache-Control', 'no-cache');
            c.header('Connection', 'keep-alive');
            
            logger.debug(`Stream started for request ${usageRecord.requestId}`);
            let chunkCount = 0;

            // Handle Debug Capture if enabled
            if (usageRecord.requestId && DebugManager.getInstance().isEnabled()) {
                finalClientStream = finalClientStream.pipeThrough(
                    DebugManager.getInstance().createDebugObserver(usageRecord.requestId, 'transformedResponse')
                );
            }

            const reader = finalClientStream.getReader();

            stream.onAbort(() => {
                logger.warn(`Client disconnected (abort) for request ${usageRecord.requestId} after ${chunkCount} chunks`);
                usageRecord.responseStatus = 'client_disconnect';
                usageStorage.saveError(usageRecord.requestId!, new Error("Client disconnected (abort)"), { 
                    phase: 'stream_transmission_client_abort',
                    chunksSent: chunkCount
                });
                reader.cancel().catch(() => {});
            });
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (usageRecord.responseStatus !== 'client_disconnect') {
                            usageRecord.responseStatus = 'success';
                        }
                        logger.debug(`Stream finished successfully for request ${usageRecord.requestId}: ${chunkCount} chunks`);
                        break;
                    }

                    chunkCount++;
                    if (chunkCount % 50 === 0) {
                        logger.debug(`Streaming request ${usageRecord.requestId}: ${chunkCount} chunks sent...`);
                    }

                    try {
                        await stream.write(value);
                    } catch (writeError: any) {
                        logger.warn(`Client disconnected prematurely during stream for request ${usageRecord.requestId}: ${writeError.message} (sent ${chunkCount} chunks)`);
                        usageRecord.responseStatus = 'client_disconnect';
                        usageStorage.saveError(usageRecord.requestId!, writeError, { 
                            phase: 'stream_transmission_client_disconnect',
                            chunksSent: chunkCount
                        });
                        await reader.cancel().catch(() => {});
                        break; 
                    }
                }
            } catch (e: any) {
                logger.error(`Stream transmission error for request ${usageRecord.requestId}: ${e.message}`);
                logger.debug(`Trace: ${e.stack}`);
                usageRecord.responseStatus = 'error_stream';
                usageStorage.saveError(usageRecord.requestId!, e, { 
                    phase: 'stream_transmission',
                    chunksSent: chunkCount
                });
                await reader.cancel().catch(() => {});
            } finally {
                reader.releaseLock();
                
                // Finalize and Save Usage Record
                usageRecord.durationMs = Date.now() - startTime;
                
                // Fallback status if not set
                if (!usageRecord.responseStatus) {
                     usageRecord.responseStatus = 'unknown'; 
                }

                // Calculate performance metrics for the record
                const totalTokens = (usageRecord.tokensInput || 0) + (usageRecord.tokensOutput || 0);
                usageRecord.ttftMs = timeToFirstToken;
                if (totalTokens > 0 && usageRecord.durationMs > 0) {
                    usageRecord.tokensPerSec = (totalTokens / usageRecord.durationMs) * 1000;
                }

                calculateCosts(usageRecord, pricing, providerDiscount);
                try {
                    usageStorage.saveRequest(usageRecord as UsageRecord);
                    logger.debug(`Usage record saved for ${usageRecord.requestId} with status ${usageRecord.responseStatus}`);
                } catch (saveError: any) {
                    logger.error(`Failed to save usage record for ${usageRecord.requestId}: ${saveError.message}`);
                }

                // Update performance metrics
                if (usageRecord.provider && usageRecord.selectedModelName) {
                    const totalTokens = (usageRecord.tokensInput || 0) + (usageRecord.tokensOutput || 0);
                    usageStorage.updatePerformanceMetrics(
                        usageRecord.provider,
                        usageRecord.selectedModelName,
                        timeToFirstToken,
                        totalTokens > 0 ? totalTokens : null,
                        usageRecord.durationMs,
                        usageRecord.requestId!
                    );
                }
            }
        });
    }

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
        DebugManager.getInstance().addTransformedResponse(usageRecord.requestId, responseBody);
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
    usageRecord.responseStatus = 'success';
    usageRecord.durationMs = Date.now() - startTime;
    
    // Performance metrics for non-streaming
    const totalTokens = (usageRecord.tokensInput || 0) + (usageRecord.tokensOutput || 0);
    usageRecord.ttftMs = usageRecord.durationMs; // TTFT = full duration for non-streaming
    if (totalTokens > 0 && usageRecord.durationMs > 0) {
        usageRecord.tokensPerSec = (totalTokens / usageRecord.durationMs) * 1000;
    }

    usageStorage.saveRequest(usageRecord as UsageRecord);

    // Update performance metrics for non-streaming requests
    if (usageRecord.provider && usageRecord.selectedModelName) {
        // For non-streaming, TTFT is approximately the full duration
        const totalTokens = (usageRecord.tokensInput || 0) + (usageRecord.tokensOutput || 0);
        usageStorage.updatePerformanceMetrics(
            usageRecord.provider,
            usageRecord.selectedModelName,
            usageRecord.durationMs, // TTFT = full duration for non-streaming
            totalTokens > 0 ? totalTokens : null,
            usageRecord.durationMs,
            usageRecord.requestId!
        );
    }

    logger.debug(`Outgoing ${apiType} Response`, responseBody);
    return c.json(responseBody);
}
