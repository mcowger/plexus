import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { UsageRecord } from '../../types/usage';
import { getClientIp } from '../../utils/ip';
import { calculateCosts } from '../../utils/calculate-costs';
import { DebugManager } from '../../services/debug-manager';
import {
  OpenAITransformer,
  AnthropicTransformer,
  GeminiTransformer,
  ResponsesTransformer,
  EmbeddingsTransformer,
  ImageTransformer,
  SpeechTransformer,
} from '../../transformers';

/**
 * Test request templates for each API type
 */
const TEST_SYSTEM_PROMPT = 'You are a helpful assistant.';
const TEST_USER_PROMPT = 'Just respond with the word acknowledged';

const TEST_TEMPLATES = {
  chat: (modelPath: string) => ({
    model: modelPath,
    stream: false,
    messages: [
      {
        role: 'system',
        content: TEST_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: TEST_USER_PROMPT,
      },
    ],
  }),

  messages: (modelPath: string) => ({
    model: modelPath,
    stream: false,
    max_tokens: 100,
    system: TEST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: TEST_USER_PROMPT }],
  }),

  gemini: (modelPath: string) => ({
    model: modelPath,
    contents: [
      {
        role: 'user',
        parts: [{ text: TEST_USER_PROMPT }],
      },
    ],
    system_instruction: {
      parts: [{ text: TEST_SYSTEM_PROMPT }],
    },
    generationConfig: {
      maxOutputTokens: 100,
    },
  }),

  responses: (modelPath: string) => ({
    model: modelPath,
    input: TEST_USER_PROMPT,
    instructions: TEST_SYSTEM_PROMPT,
  }),

  embeddings: (modelPath: string) => ({
    model: modelPath,
    input: ['Hello world'],
  }),

  images: (modelPath: string) => ({
    model: modelPath,
    prompt: 'A tiny 256x256 red square',
    n: 1,
    size: '256x256',
  }),

  speech: (modelPath: string) => ({
    model: modelPath,
    input: 'Hello world',
  }),

  oauth: (_modelPath: string) => ({
    context: {
      systemPrompt: TEST_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: TEST_USER_PROMPT,
          timestamp: Date.now(),
        },
      ],
    },
    options: {
      maxTokens: 100,
    },
  }),
};

export async function registerTestRoutes(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  /**
   * POST /v0/management/test
   * Test a specific provider/model combination with a simple request
   */
  fastify.post('/v0/management/test', async (request, reply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'chat',
      startTime,
      isStreamed: false,
      responseStatus: 'pending',
      incomingModelAlias: 'test-request',
    };

    // Emit 'started' event immediately
    usageStorage.emitStartedAsync(usageRecord);

    try {
      const body = request.body as { provider: string; model: string; apiType?: string };

      logger.info('Test endpoint called with body:', body);

      if (!body.provider || !body.model) {
        return reply.code(400).send({
          success: false,
          error: 'Both provider and model are required',
        });
      }

      // Default to 'chat' if no apiType specified
      const apiType = body.apiType || 'chat';

      usageRecord.incomingApiType = apiType;
      usageRecord.incomingModelAlias = `direct/${body.provider}/${body.model}`;
      usageRecord.apiKey = (request as any).keyName;

      logger.info(`Testing model: ${body.provider}/${body.model} via ${apiType} API`);

      // Validate API type
      if (
        ![
          'chat',
          'messages',
          'gemini',
          'responses',
          'embeddings',
          'images',
          'transcriptions',
          'speech',
          'oauth',
        ].includes(apiType)
      ) {
        return reply.code(400).send({
          success: false,
          error: `Invalid API type: ${apiType}. Must be one of: chat, messages, gemini, responses, embeddings, images, transcriptions, speech, oauth`,
        });
      }

      // Create a simple test request using the appropriate format
      // Use direct/provider/model format for direct routing (bypasses alias resolution)
      const directModelPath = `direct/${body.provider}/${body.model}`;
      logger.info(`Direct model path: ${directModelPath}`);

      const testRequest = TEST_TEMPLATES[apiType as keyof typeof TEST_TEMPLATES](directModelPath);

      logger.info('Creating transformer...');
      let dispatchMethod: 'dispatch' | 'dispatchEmbeddings' | 'dispatchImageGenerations' =
        'dispatch';
      let imageRequestData: {
        model: string;
        prompt: string;
        n?: number;
        size?: string;
        response_format?: 'url' | 'b64_json';
        quality?: string;
        style?: string;
        user?: string;
      } | null = null;
      switch (apiType) {
        case 'chat':
        case 'messages':
        case 'gemini':
        case 'responses':
        case 'speech':
          // These use the standard dispatch path with transformers
          break;
        case 'embeddings':
          dispatchMethod = 'dispatchEmbeddings';
          break;
        case 'images':
          dispatchMethod = 'dispatchImageGenerations';
          const imgReq = testRequest as {
            model: string;
            prompt: string;
            n?: number;
            size?: string;
            quality?: string;
            style?: string;
            user?: string;
          };
          imageRequestData = {
            model: imgReq.model,
            prompt: imgReq.prompt,
            n: imgReq.n,
            size: imgReq.size,
            response_format: 'url' as const,
            quality: imgReq.quality,
            style: imgReq.style,
            user: imgReq.user,
          };
          break;
        default:
          break;
      }

      logger.info('Dispatching request...');
      let response;

      if (apiType === 'transcriptions') {
        return reply.code(400).send({
          success: false,
          error:
            'Cannot test transcriptions API via test endpoint - requires file upload. Use the actual /v1/audio/transcriptions endpoint to test.',
        });
      }

      if (apiType === 'oauth') {
        const { context, options } = testRequest as {
          context: { systemPrompt?: string; messages: Array<{ role: string; content: any }> };
          options?: Record<string, any>;
        };

        const unifiedRequest = {
          model: directModelPath,
          messages: [
            ...(context.systemPrompt ? [{ role: 'system', content: context.systemPrompt }] : []),
            ...context.messages.map((message) => ({
              role: message.role as any,
              content: message.content,
            })),
          ],
          incomingApiType: 'oauth',
          originalBody: { context, options },
        };

        response = await dispatcher.dispatch(unifiedRequest);
      } else if (dispatchMethod === 'dispatchEmbeddings') {
        response = await dispatcher.dispatchEmbeddings({
          model: directModelPath,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'embeddings',
        });
      } else if (dispatchMethod === 'dispatchImageGenerations' && imageRequestData) {
        response = await dispatcher.dispatchImageGenerations({
          ...imageRequestData,
          originalBody: testRequest,
          requestId,
          incomingApiType: 'images',
        });
      } else if (apiType === 'speech') {
        const { SpeechTransformer } = await import('../../transformers/speech');
        const transformer = new SpeechTransformer();
        const unifiedRequest = await transformer.parseRequest(testRequest);
        unifiedRequest.incomingApiType = 'speech';
        unifiedRequest.originalBody = testRequest;
        unifiedRequest.requestId = requestId;
        response = await dispatcher.dispatchSpeech(unifiedRequest);
      } else {
        // chat, messages, gemini, responses all use transformers with parseRequest
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
          case 'responses':
            transformer = new ResponsesTransformer();
            break;
          default:
            transformer = new OpenAITransformer();
        }
        const unifiedRequest = await transformer.parseRequest(testRequest);
        unifiedRequest.incomingApiType = apiType;
        unifiedRequest.originalBody = testRequest;
        unifiedRequest.requestId = requestId;
        response = await dispatcher.dispatch(unifiedRequest);
      }

      const durationMs = Date.now() - startTime;

      // Update usage record with routing details from response
      usageRecord.provider = response.plexus?.provider;
      usageRecord.selectedModelName = response.plexus?.model;
      usageRecord.canonicalModelName = response.plexus?.canonicalModel;
      usageRecord.outgoingApiType = response.plexus?.apiType;
      usageRecord.durationMs = durationMs;
      usageRecord.responseStatus = 'success';
      usageRecord.isPassthrough =
        apiType !== 'chat' &&
        apiType !== 'messages' &&
        apiType !== 'gemini' &&
        apiType !== 'responses';
      usageRecord.attemptCount = response.plexus?.attemptCount || 1;
      usageRecord.retryHistory = response.plexus?.retryHistory || null;
      usageRecord.finalAttemptProvider =
        response.plexus?.finalAttemptProvider || usageRecord.provider || null;
      usageRecord.finalAttemptModel =
        response.plexus?.finalAttemptModel || usageRecord.selectedModelName || null;
      usageRecord.allAttemptedProviders = response.plexus?.allAttemptedProviders || null;

      // Capture token usage if available
      if (response.usage) {
        usageRecord.tokensInput = response.usage.input_tokens;
        usageRecord.tokensOutput = response.usage.output_tokens;
        usageRecord.tokensCached = response.usage.cached_tokens;
        usageRecord.tokensCacheWrite = response.usage.cache_creation_tokens;
        usageRecord.tokensReasoning = response.usage.reasoning_tokens;
      }

      const pricing = response.plexus?.pricing;
      const providerDiscount = response.plexus?.providerDiscount;
      calculateCosts(usageRecord, pricing, providerDiscount);

      // Emit 'updated' event with routing details
      usageStorage.emitUpdatedAsync({
        requestId,
        provider: usageRecord.provider,
        selectedModelName: usageRecord.selectedModelName,
        canonicalModelName: usageRecord.canonicalModelName,
      });

      // Save usage record
      usageStorage.saveRequest(usageRecord as UsageRecord);

      logger.info(`Test completed in ${durationMs}ms`);

      // Extract response text based on API type
      let responseText: string;
      if (apiType === 'images') {
        responseText =
          response.data && Array.isArray(response.data)
            ? `Success (${response.data.length} image${response.data.length > 1 ? 's' : ''} created)`
            : 'Success';
      } else if (apiType === 'embeddings') {
        responseText =
          response.data && Array.isArray(response.data)
            ? `Success (${response.data.length} embedding${response.data.length > 1 ? 's' : ''})`
            : 'Success';
      } else {
        responseText = response.content
          ? typeof response.content === 'string'
            ? response.content.substring(0, 100)
            : 'Success'
          : 'Success';
      }

      return reply.code(200).send({
        success: true,
        durationMs,
        apiType,
        response: responseText,
      });
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      logger.error('Error testing model:', e);
      logger.error('Error stack:', e.stack);

      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = durationMs;
      usageRecord.attemptCount = e.routingContext?.attemptCount || usageRecord.attemptCount || 1;
      usageRecord.retryHistory = e.routingContext?.retryHistory || usageRecord.retryHistory || null;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: (request.body as any)?.apiType || 'chat',
        ...(e.routingContext || {}),
      };
      usageStorage.saveError(requestId, e, errorDetails);

      DebugManager.getInstance().flush(requestId);

      return reply.code(200).send({
        success: false,
        error: e.message || 'Unknown error',
        durationMs,
        apiType: (request.body as any)?.apiType || 'chat',
      });
    }
  });
}
