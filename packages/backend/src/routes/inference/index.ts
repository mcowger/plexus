import { FastifyInstance } from 'fastify';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { registerModelsRoute } from './models';
import { registerChatRoute } from './chat';
import { registerMessagesRoute } from './messages';
import { registerGeminiRoute } from './gemini';
import { registerResponsesRoute } from './responses';

export async function registerInferenceRoutes(fastify: FastifyInstance, dispatcher: Dispatcher, usageStorage: UsageStorageService) {
    await registerModelsRoute(fastify);
    await registerChatRoute(fastify, dispatcher, usageStorage);
    await registerMessagesRoute(fastify, dispatcher, usageStorage);
    await registerGeminiRoute(fastify, dispatcher, usageStorage);
    await registerResponsesRoute(fastify);
}
