import bearerAuth from '@fastify/bearer-auth';
import { FastifyInstance } from 'fastify';

import { Dispatcher } from '../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../services/observability/usage-storage';
import { QuotaEnforcer } from '../../services/quota/quota-enforcer';
import { createAuthHook } from '../../utils/auth';
import { registerChatRoute } from './chat';
import { registerCompletionsRoute } from './completions';
import { registerDecisionsRoute } from './decisions';
import { registerEmbeddingsRoute } from './embeddings';
import { registerGeminiRoute } from './gemini';
import { registerImagesRoute } from './images';
import { registerMessagesRoute } from './messages';
import { registerModelsRoute, registerMuseCodeModelsRoute } from './models';
import { registerResponsesRoute } from './responses';
import { registerSpeechRoute } from './speech';
import { registerTranscriptionsRoute } from './transcriptions';

export async function registerInferenceRoutes(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
) {
  // Public Routes (Excluded from Auth)
  await registerModelsRoute(fastify);

  // Protected Routes (v1 and v1beta)
  fastify.register(async (protectedRoutes) => {
    const auth = createAuthHook();

    protectedRoutes.addHook('onRequest', auth.onRequest);

    await protectedRoutes.register(bearerAuth, auth.bearerAuthOptions);

    await registerMuseCodeModelsRoute(protectedRoutes);
    await registerChatRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerMessagesRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerGeminiRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerResponsesRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerCompletionsRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerDecisionsRoute(protectedRoutes, dispatcher, usageStorage, quotaEnforcer);
    await registerEmbeddingsRoute(protectedRoutes, dispatcher, usageStorage);
    await registerTranscriptionsRoute(protectedRoutes, dispatcher, usageStorage);
    await registerSpeechRoute(protectedRoutes, dispatcher, usageStorage);
    await registerImagesRoute(protectedRoutes, dispatcher, usageStorage);
  });
}
