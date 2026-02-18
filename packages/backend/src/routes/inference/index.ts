import { FastifyInstance } from 'fastify';
import bearerAuth from '@fastify/bearer-auth';
import { createAuthHook } from '../../utils/auth';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { registerModelsRoute } from './models';
import { registerChatRoute } from './chat';
import { registerMessagesRoute } from './messages';
import { registerGeminiRoute } from './gemini';
import { registerEmbeddingsRoute } from './embeddings';
import { registerTranscriptionsRoute } from './transcriptions';
import { registerSpeechRoute } from './speech';
import { registerImagesRoute } from './images';
import { registerResponsesRoute } from './responses';

export async function registerInferenceRoutes(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService, quotaEnforcer?: QuotaEnforcer) {
    // Public Routes (Excluded from Auth)
    await registerModelsRoute(fastify);
    
    // Protected Routes (v1 and v1beta)
    fastify.register(async (protectedRoutes) => {
        const auth = createAuthHook();
        
        protectedRoutes.addHook('onRequest', auth.onRequest);

        await protectedRoutes.register(bearerAuth, auth.bearerAuthOptions);

        await registerChatRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
        await registerMessagesRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
        await registerGeminiRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
        await registerResponsesRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
        await registerEmbeddingsRoute(protectedRoutes, dispatcher, usageStorage);
        await registerTranscriptionsRoute(protectedRoutes, dispatcher, usageStorage);
        await registerSpeechRoute(protectedRoutes, dispatcher, usageStorage);
        await registerImagesRoute(protectedRoutes, dispatcher, usageStorage);
    });
}
