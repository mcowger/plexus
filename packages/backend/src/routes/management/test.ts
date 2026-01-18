import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { OpenAITransformer, AnthropicTransformer, GeminiTransformer } from '../../transformers';

/**
 * Test request templates for each API type
 */
const TEST_TEMPLATES = {
    chat: (modelPath: string) => ({
        model: modelPath,
        messages: [
            {
                role: 'system',
                content: 'You are a helpful assistant.'
            },
            {
                role: 'user',
                content: 'Just respond with the word acknowledged'
            }
        ]
    }),

    messages: (modelPath: string) => ({
        model: modelPath,
        max_tokens: 100,
        system: 'You are a helpful assistant.',
        messages: [
            { role: 'user', content: 'Just respond with the word acknowledged' }
        ]
    }),

    gemini: (modelPath: string) => ({
        model: modelPath,
        contents: [
            {
                role: 'user',
                parts: [
                    { text: 'Just respond with the word acknowledged' }
                ]
            }
        ],
        system_instruction: {
            parts: [
                { text: 'You are a helpful assistant.' }
            ]
        },
        generationConfig: {
            maxOutputTokens: 100
        }
    })
};

export async function registerTestRoutes(fastify: FastifyInstance, dispatcher: Dispatcher) {
    /**
     * POST /v0/management/test
     * Test a specific provider/model combination with a simple request
     */
    fastify.post('/v0/management/test', async (request, reply) => {
        const requestId = crypto.randomUUID();
        const startTime = Date.now();

        try {
            const body = request.body as { provider: string; model: string; apiType?: string };

            logger.info('Test endpoint called with body:', body);

            if (!body.provider || !body.model) {
                return reply.code(400).send({
                    success: false,
                    error: 'Both provider and model are required'
                });
            }

            // Default to 'chat' if no apiType specified
            const apiType = body.apiType || 'chat';

            logger.info(`Testing model: ${body.provider}/${body.model} via ${apiType} API`);

            // Validate API type
            if (!['chat', 'messages', 'gemini'].includes(apiType)) {
                return reply.code(400).send({
                    success: false,
                    error: `Invalid API type: ${apiType}. Must be one of: chat, messages, gemini`
                });
            }

            // Create a simple test request using the appropriate format
            // Use provider/model format for direct routing (bypasses alias resolution)
            const directModelPath = `${body.provider}/${body.model}`;
            logger.info(`Direct model path: ${directModelPath}`);

            const testRequest = TEST_TEMPLATES[apiType as keyof typeof TEST_TEMPLATES](directModelPath);

            logger.info('Creating transformer...');
            let transformer;
            switch (apiType) {
                case 'chat':
                    transformer = new OpenAITransformer();
                    break;
                case 'messages':
                    transformer = new AnthropicTransformer();
                    break;
                case 'gemini':
                    transformer = new GeminiTransformer();
                    break;
                default:
                    transformer = new OpenAITransformer();
            }

            logger.info('Parsing request...');
            const unifiedRequest = await transformer.parseRequest(testRequest);
            unifiedRequest.incomingApiType = apiType;
            unifiedRequest.originalBody = testRequest;
            unifiedRequest.requestId = requestId;

            logger.info('Dispatching request...');
            const unifiedResponse = await dispatcher.dispatch(unifiedRequest);

            const durationMs = Date.now() - startTime;

            logger.info(`Test completed in ${durationMs}ms`);

            // Extract response text
            const responseText = unifiedResponse.content
                ? (typeof unifiedResponse.content === 'string'
                    ? unifiedResponse.content.substring(0, 100)
                    : 'Success')
                : 'Success';

            return reply.code(200).send({
                success: true,
                durationMs,
                apiType,
                response: responseText
            });
        } catch (e: any) {
            const durationMs = Date.now() - startTime;
            logger.error('Error testing model:', e);
            logger.error('Error stack:', e.stack);

            return reply.code(200).send({
                success: false,
                error: e.message || 'Unknown error',
                durationMs,
                apiType: (request.body as any)?.apiType || 'chat'
            });
        }
    });
}
