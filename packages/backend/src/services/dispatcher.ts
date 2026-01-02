import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { Router } from './router';
import { TransformerFactory } from './transformer-factory';
import { logger } from '../utils/logger';
import { CooldownManager } from './cooldown-manager';
import { DebugManager } from './debug-manager';

export class Dispatcher {
    async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
        // 1. Route
        const route = Router.resolve(request.model);
        
        // 2. Get Transformer
        const transformer = TransformerFactory.getTransformer(route.config.type);
        
        // 3. Transform Request
        // Override model in request to the target model
        const requestWithTargetModel = { ...request, model: route.model };
        
        let providerPayload;

        // Pass-through Optimization
        // request.incomingApiType is now 'chat', 'messages', or 'gemini'
        // route.config.type is 'OpenAI', 'Anthropic', or 'Gemini'/'Google'
        
        const incoming = request.incomingApiType?.toLowerCase();
        const outgoing = route.config.type?.toLowerCase();
        
        let isCompatible = false;
        if (incoming && outgoing) {
             if (incoming === 'chat' && outgoing === 'openai') isCompatible = true;
             else if (incoming === 'messages' && outgoing === 'anthropic') isCompatible = true;
             else if (incoming === 'gemini' && (outgoing === 'google' || outgoing === 'gemini')) isCompatible = true;
        }

        let bypassTransformation = false;

        if (isCompatible && request.originalBody) {
             logger.info(`Pass-through optimization active: ${request.incomingApiType} -> ${route.config.type}`);
             try {
                providerPayload = JSON.parse(JSON.stringify(request.originalBody));
                // Swap model if present in body
                if (providerPayload.model) {
                    providerPayload.model = route.model;
                }
                bypassTransformation = true;
             } catch (e) {
                 logger.warn('Failed to clone originalBody, falling back to full transformation', e);
                 providerPayload = await transformer.transformRequest(requestWithTargetModel);
                 bypassTransformation = false;
             }
        } else {
             providerPayload = await transformer.transformRequest(requestWithTargetModel);
        }

        if (route.config.extraBody) {
            providerPayload = { ...providerPayload, ...route.config.extraBody };
        }

        if (request.requestId) {
            DebugManager.getInstance().addTransformedRequest(request.requestId, providerPayload);
        }
        
        // 4. Execute Request
        // Ensure api_base_url doesn't end with slash if endpoint starts with slash, or handle cleanly
        const baseUrl = route.config.api_base_url.replace(/\/$/, '');
        const endpoint = transformer.getEndpoint ? 
                        transformer.getEndpoint(requestWithTargetModel) : 
                        transformer.defaultEndpoint;
        const url = `${baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        
        if (route.config.api_key) {
             const type = route.config.type.toLowerCase();
             if (type === 'anthropic') {
                 headers['x-api-key'] = route.config.api_key;
                 headers['anthropic-version'] = '2023-06-01'; 
             } else if (type === 'gemini' || type === 'google') {
                 headers['x-goog-api-key'] = route.config.api_key;
             } else {
                 // Default to Bearer for OpenAI and others
                 headers['Authorization'] = `Bearer ${route.config.api_key}`;
             }
        }
        
        // TODO: Handle extra headers from config?
        if (route.config.headers) {
            Object.assign(headers, route.config.headers);
        }

        const incomingApi = request.incomingApiType || 'unknown';

        logger.info(`Dispatching ${request.model} to ${route.provider}:${route.model} ${incomingApi} <-> ${transformer.name}`);
        logger.silly('Upstream Request Payload', providerPayload);
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(providerPayload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Provider error: ${response.status} ${errorText}`);

            if (response.status >= 500 || [401, 408, 429].includes(response.status)) {
                CooldownManager.getInstance().markProviderFailure(route.provider);
            }

            throw new Error(`Provider failed: ${response.status} ${errorText}`);
        }
        
        // 5. Transform Response
        if (request.stream) {
            logger.info('Streaming response detected, transforming stream');
            
            let rawStream = response.body!;
            if (request.requestId && DebugManager.getInstance().isEnabled()) {
                const [s1, s2] = rawStream.tee();
                rawStream = s1;
                DebugManager.getInstance().captureStream(request.requestId, s2, 'rawResponse');
            }

            let clientStream = rawStream;
            let usageStream = rawStream;
            
            if (bypassTransformation) {
                 const [s1, s2] = rawStream.tee();
                 clientStream = s1;
                 usageStream = s2;
            }

            const unifiedStream = transformer.transformStream ? 
                                transformer.transformStream(usageStream) : 
                                usageStream;

            return {
                id: 'stream-' + Date.now(),
                model: request.model,
                content: null,
                stream: unifiedStream,
                rawStream: bypassTransformation ? clientStream : undefined,
                bypassTransformation: bypassTransformation,
                plexus: {
                    provider: route.provider,
                    model: route.model,
                    apiType: route.config.type,
                    pricing: route.modelConfig?.pricing
                }
            };
        }

        const responseText = await response.text();
        if (request.requestId && DebugManager.getInstance().isEnabled()) {
            // Try to parse as JSON for cleaner logging if possible, otherwise string
            try {
                DebugManager.getInstance().addRawResponse(request.requestId, JSON.parse(responseText));
            } catch {
                DebugManager.getInstance().addRawResponse(request.requestId, responseText);
            }
        }

        if (!responseText || responseText.trim() === '') {
             logger.warn('Received empty response from provider');
             return {
                 id: 'empty-' + Date.now(),
                 model: request.model,
                 content: null,
                 plexus: {
                    provider: route.provider,
                    model: route.model,
                    apiType: route.config.type,
                    pricing: route.modelConfig?.pricing
                 }
             };
        }

        const responseBody = JSON.parse(responseText);
        logger.silly('Upstream Response Payload', responseBody);
        
        let unifiedResponse: UnifiedChatResponse;

        if (bypassTransformation) {
             // We still need unified response for usage stats, so we transform purely for that
             // But we set the bypass flag and attach raw response
             const syntheticResponse = await transformer.transformResponse(responseBody);
             unifiedResponse = {
                 ...syntheticResponse,
                 bypassTransformation: true,
                 rawResponse: responseBody
             };
        } else {
             unifiedResponse = await transformer.transformResponse(responseBody);
        }

        unifiedResponse.plexus = {
            provider: route.provider,
            model: route.model,
            apiType: route.config.type,
            pricing: route.modelConfig?.pricing
        };
        
        return unifiedResponse;
    }
}
