import { FastifyInstance } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import { getConfig } from '../../config';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { registerModelsRoute } from './models';
import { registerChatRoute } from './chat';
import { registerMessagesRoute } from './messages';
import { registerGeminiRoute } from './gemini';
import { registerResponsesRoute } from './responses';

export async function registerInferenceRoutes(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService) {
    // Public Routes (Excluded from Auth)
    await registerModelsRoute(fastify);
    
    // Protected Routes (v1 and v1beta)
    fastify.register(async (protectedRoutes) => {
        // Normalize various API Key formats to Bearer Auth so the plugin can verify them
        protectedRoutes.addHook('onRequest', async (request) => {
            if (!request.headers.authorization) {
                // Check headers: x-api-key (Anthropic), x-goog-api-key (Gemini)
                let apiKey = request.headers['x-api-key'] || request.headers['x-goog-api-key'];
                
                // Also check query parameter 'key' (Gemini)
                if (!apiKey && request.query && typeof request.query === 'object') {
                    apiKey = (request.query as any).key;
                }

                if (typeof apiKey === 'string') {
                    request.headers.authorization = `Bearer ${apiKey}`;
                }
            }
        });

        await protectedRoutes.register(bearerAuth, {
            keys: new Set([]), // We use the auth function for dynamic validation against config
            auth: (key: string, req: any) => {
                const config = getConfig();
                if (!config.keys) return false;
                
                // Check if the provided key matches any secret in the config
                const entry = Object.entries(config.keys).find(([_, k]) => k.secret === key);
                
                if (entry) {
                    // Attach the key name (identifier) to the request for usage tracking
                    req.keyName = entry[0];
                    return true;
                }
                return false;
            },
            errorResponse: ((err: Error) => {
                return { error: { message: err.message, type: 'auth_error', code: 401 } };
            }) as any
        });

        await registerChatRoute(protectedRoutes, dispatcher, usageStorage);
        await registerMessagesRoute(protectedRoutes, dispatcher, usageStorage);
        await registerGeminiRoute(protectedRoutes, dispatcher, usageStorage);
        await registerResponsesRoute(protectedRoutes);
    });
}
