import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { UnifiedChatResponse } from '../types/unified';
import { Transformer } from '../types/transformer';
import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from './logger';
import { DebugManager } from '../services/debug-manager';

function calculateCosts(usageRecord: Partial<UsageRecord>, pricing: any) {
    if (!pricing || pricing.source !== 'simple') return;

    const inputTokens = usageRecord.tokensInput || 0;
    const outputTokens = usageRecord.tokensOutput || 0;
    const cachedTokens = usageRecord.tokensCached || 0;

    // Prices are usually per 1M tokens in simple config, let's assume that based on your example (0.15 for input)
    // Actually, your prompt said "input: 0.15", "output: 0.20", "cached: 0.1". 
    // Usually these are per Million tokens in LLM pricing.
    
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached || 0);

    usageRecord.costInput = Number(inputCost.toFixed(8));
    usageRecord.costOutput = Number(outputCost.toFixed(8));
    usageRecord.costCached = Number(cachedCost.toFixed(8));
    usageRecord.costTotal = Number((inputCost + outputCost + cachedCost).toFixed(8));
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
    // Standardize API types
    if (outgoingApiType === 'openai') outgoingApiType = 'chat';
    else if (outgoingApiType === 'anthropic') outgoingApiType = 'messages';
    else if (outgoingApiType === 'google') outgoingApiType = 'gemini';
    
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
