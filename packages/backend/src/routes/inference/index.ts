import { FastifyInstance } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import { getConfig } from '../../config';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { registerModelsRoute } from './models';
import { registerChatRoute } from './chat';
import { registerMessagesRoute } from './messages';
import { registerGeminiRoute } from './gemini';
import { registerEmbeddingsRoute } from './embeddings';
import { registerTranscriptionsRoute } from './transcriptions';
import { registerSpeechRoute } from './speech';
import { registerImagesRoute } from './images';
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

                // Parse the key to extract secret and optional attribution
                // Format: "secret:attribution" where attribution can contain colons
                // Split on first colon only
                let secretPart: string;
                let attributionPart: string | null = null;

                const firstColonIndex = key.indexOf(':');
                if (firstColonIndex !== -1) {
                    secretPart = key.substring(0, firstColonIndex);
                    const rawAttribution = key.substring(firstColonIndex + 1);
                    // Normalize to lowercase, treat empty string as null
                    attributionPart = rawAttribution.toLowerCase() || null;
                } else {
                    secretPart = key;
                }

                // Check if the secret part matches any secret in the config
                const entry = Object.entries(config.keys).find(([_, k]) => k.secret === secretPart);

                if (entry) {
                    // Attach the key name (identifier) to the request for usage tracking
                    req.keyName = entry[0];
                    // Attach the attribution label if present
                    req.attribution = attributionPart;
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
        await registerResponsesRoute(protectedRoutes, dispatcher, usageStorage);
        await registerEmbeddingsRoute(protectedRoutes, dispatcher, usageStorage);
        await registerTranscriptionsRoute(protectedRoutes, dispatcher, usageStorage);
        await registerSpeechRoute(protectedRoutes, dispatcher, usageStorage);
        await registerImagesRoute(protectedRoutes, dispatcher, usageStorage);
    });
}
