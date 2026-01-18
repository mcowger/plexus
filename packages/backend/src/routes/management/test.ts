import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { OpenAITransformer } from '../../transformers';

export async function registerTestRoutes(fastify: FastifyInstance, dispatcher: Dispatcher) {
    /**
     * POST /v0/management/test
     * Test a specific provider/model combination with a simple request
     */
    fastify.post('/v0/management/test', async (request, reply) => {
        const requestId = crypto.randomUUID();
        const startTime = Date.now();

        try {
            const body = request.body as { provider: string; model: string };

            logger.info('Test endpoint called with body:', body);

            if (!body.provider || !body.model) {
                return reply.code(400).send({
                    success: false,
                    error: 'Both provider and model are required'
                });
            }

            logger.info(`Testing model: ${body.provider}/${body.model}`);

            // Create a simple test request using OpenAI format
            // Use provider/model format for direct routing (bypasses alias resolution)
            const directModelPath = `${body.provider}/${body.model}`;
            logger.info(`Direct model path: ${directModelPath}`);

            const testRequest = {
                model: directModelPath,
                messages: [
                    { role: 'user', content: 'Say "test successful" if you can read this.' }
                ],
                max_tokens: 50
            };

            logger.info('Creating transformer...');
            const transformer = new OpenAITransformer();

            logger.info('Parsing request...');
            const unifiedRequest = await transformer.parseRequest(testRequest);
            unifiedRequest.incomingApiType = 'chat';
            unifiedRequest.originalBody = testRequest;
            unifiedRequest.requestId = requestId;

            logger.info('Dispatching request...');
            const unifiedResponse = await dispatcher.dispatch(unifiedRequest);

            const durationMs = Date.now() - startTime;

            logger.info(`Test completed in ${durationMs}ms`);

            // Check if successful
            if (unifiedResponse.error) {
                return reply.code(200).send({
                    success: false,
                    error: unifiedResponse.error.message || 'Test failed',
                    durationMs
                });
            }

            return reply.code(200).send({
                success: true,
                durationMs,
                response: unifiedResponse.content?.[0]?.text?.substring(0, 100) || 'Success'
            });
        } catch (e: any) {
            const durationMs = Date.now() - startTime;
            logger.error('Error testing model:', e);
            logger.error('Error stack:', e.stack);

            return reply.code(200).send({
                success: false,
                error: e.message || 'Unknown error',
                durationMs
            });
        }
    });
}
