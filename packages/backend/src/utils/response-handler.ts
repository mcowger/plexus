import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { UnifiedChatResponse } from '../types/unified';
import { Transformer } from '../types/transformer';
import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from './logger';
import { DebugManager } from '../services/debug-manager';
import { PricingManager } from '../services/pricing-manager';

function calculateCosts(usageRecord: Partial<UsageRecord>, pricing: any) {
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
            calculated = true;
            
            usageRecord.costSource = 'openrouter';
            usageRecord.costMetadata = JSON.stringify({
                slug: pricing.slug,
                prompt: promptRate,
                completion: completionRate,
                input_cache_read: cacheReadRate
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

    if (unifiedResponse.stream) {
        // Tee the stream to track usage
        const [logStream, clientStreamSource] = unifiedResponse.stream.tee();

        // Background processing of the stream for logging
        (async () => {
            const reader = logStream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    // Extract usage if present in the chunk
                    if (value && value.usage) {
                        usageRecord.tokensInput = value.usage.input_tokens;
                        usageRecord.tokensOutput = value.usage.output_tokens;
                        usageRecord.tokensCached = value.usage.cached_tokens;
                        usageRecord.tokensReasoning = value.usage.reasoning_tokens;
                    }
                }
                
                calculateCosts(usageRecord, pricing);
                usageRecord.responseStatus = 'success';
            } catch (e) {
                usageRecord.responseStatus = 'error_stream';
            } finally {
                usageRecord.durationMs = Date.now() - startTime;
                // Save record
                usageStorage.saveRequest(usageRecord as UsageRecord);
            }
        })();

        return stream(c, async (stream) => {
            c.header('Content-Type', 'text/event-stream');
            c.header('Cache-Control', 'no-cache');
            c.header('Connection', 'keep-alive');
            
            let clientStream: ReadableStream;
            
            if (unifiedResponse.bypassTransformation && unifiedResponse.rawStream) {
                 clientStream = unifiedResponse.rawStream;
            } else {
                 clientStream = transformer.formatStream ? 
                               transformer.formatStream(clientStreamSource) : 
                               clientStreamSource;
            }

            if (usageRecord.requestId && DebugManager.getInstance().isEnabled()) {
                const [s1, s2] = clientStream.tee();
                clientStream = s1;
                DebugManager.getInstance().captureStream(usageRecord.requestId, s2, 'transformedResponse');
            }

            const reader = clientStream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await stream.write(value);
                }
            } finally {
                reader.releaseLock();
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

    calculateCosts(usageRecord, pricing);
    usageRecord.responseStatus = 'success';
    usageRecord.durationMs = Date.now() - startTime;
    usageStorage.saveRequest(usageRecord as UsageRecord);

    logger.debug(`Outgoing ${apiType} Response`, responseBody);
    return c.json(responseBody);
}
