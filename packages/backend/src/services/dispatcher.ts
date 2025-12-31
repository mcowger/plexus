import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { Router } from './router';
import { TransformerFactory } from './transformer-factory';
import { logger } from '../utils/logger';

export class Dispatcher {
    async dispatch(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
        // 1. Route
        const route = Router.resolve(request.model);
        
        // 2. Get Transformer
        const transformer = TransformerFactory.getTransformer(route.config.type);
        
        // 3. Transform Request
        // Override model in request to the target model
        const requestWithTargetModel = { ...request, model: route.model };
        
        const providerPayload = await transformer.transformRequest(requestWithTargetModel);
        
        // 4. Execute Request
        // Ensure api_base_url doesn't end with slash if endpoint starts with slash, or handle cleanly
        const baseUrl = route.config.api_base_url.replace(/\/$/, '');
        const endpoint = transformer.defaultEndpoint; // e.g. /chat/completions
        const url = `${baseUrl}${endpoint}`;
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        
        if (route.config.api_key) {
             const type = route.config.type.toLowerCase();
             if (type === 'anthropic') {
                 headers['x-api-key'] = route.config.api_key;
                 headers['anthropic-version'] = '2023-06-01'; 
             } else {
                 // Default to Bearer for OpenAI and others
                 headers['Authorization'] = `Bearer ${route.config.api_key}`;
             }
        }
        
        // TODO: Handle extra headers from config?
        if (route.config.headers) {
            Object.assign(headers, route.config.headers);
        }

        logger.info(`Dispatching to ${url} (Model: ${route.model})`);
        logger.silly('Upstream Request Payload', providerPayload);
        
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(providerPayload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Provider error: ${response.status} ${errorText}`);
            throw new Error(`Provider failed: ${response.status} ${errorText}`);
        }
        
        // 5. Transform Response
        if (request.stream) {
            logger.info('Streaming response detected, transforming stream');
            const unifiedStream = transformer.transformStream ? 
                                transformer.transformStream(response.body) : 
                                response.body;

            return {
                id: 'stream-' + Date.now(),
                model: request.model,
                content: null,
                stream: unifiedStream
            };
        }

        const responseBody = await response.json();
        logger.silly('Upstream Response Payload', responseBody);
        const unifiedResponse = await transformer.transformResponse(responseBody);
        
        return unifiedResponse;
    }
}
