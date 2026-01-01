import { Context } from 'hono';
import { stream } from 'hono/streaming';
import { UnifiedChatResponse } from '../types/unified';
import { Transformer } from '../types/transformer';
import { UsageRecord } from '../types/usage';
import { UsageStorageService } from '../services/usage-storage';
import { logger } from './logger';

export async function handleResponse(
    c: Context,
    unifiedResponse: UnifiedChatResponse,
    transformer: Transformer,
    usageRecord: Partial<UsageRecord>,
    usageStorage: UsageStorageService,
    startTime: number,
    apiType: 'openai' | 'anthropic' | 'gemini'
) {
    // Update record with selected model info if available
    usageRecord.selectedModelName = unifiedResponse.plexus?.model || unifiedResponse.model;
    usageRecord.provider = unifiedResponse.plexus?.provider;
    usageRecord.outgoingApiType = unifiedResponse.plexus?.apiType;
    usageRecord.isStreamed = !!unifiedResponse.stream;

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
                        usageRecord.tokensInput = value.usage.prompt_tokens;
                        usageRecord.tokensOutput = value.usage.completion_tokens;
                        usageRecord.tokensCached = value.usage.prompt_tokens_details?.cached_tokens;
                        usageRecord.tokensReasoning = value.usage.completion_tokens_details?.reasoning_tokens;
                    }
                }
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
            
            const clientStream = transformer.formatStream ? 
                               transformer.formatStream(clientStreamSource) : 
                               clientStreamSource;

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

    const responseBody = await transformer.formatResponse(unifiedResponse);
    
    // Populate usage stats
    if (unifiedResponse.usage) {
        usageRecord.tokensInput = unifiedResponse.usage.prompt_tokens;
        usageRecord.tokensOutput = unifiedResponse.usage.completion_tokens;
        usageRecord.tokensCached = unifiedResponse.usage.prompt_tokens_details?.cached_tokens;
        usageRecord.tokensReasoning = unifiedResponse.usage.completion_tokens_details?.reasoning_tokens;
    }

    usageRecord.responseStatus = 'success';
    usageRecord.durationMs = Date.now() - startTime;
    usageStorage.saveRequest(usageRecord as UsageRecord);

    const apiName = apiType === 'openai' ? 'OpenAI' : apiType === 'anthropic' ? 'Anthropic' : 'Gemini';
    logger.debug(`Outgoing ${apiName} Response`, responseBody);
    return c.json(responseBody);
}
