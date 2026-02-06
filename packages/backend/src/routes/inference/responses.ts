import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../../services/dispatcher';
import { ResponsesTransformer } from '../../transformers/responses';
import { UsageStorageService } from '../../services/usage-storage';
import { ResponsesStorageService } from '../../services/responses-storage';
import { UsageRecord } from '../../types/usage';
import { handleResponse } from '../../services/response-handler';
import { getClientIp } from '../../utils/ip';
import { DebugManager } from '../../services/debug-manager';

export async function registerResponsesRoute(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  const responsesStorage = new ResponsesStorageService();

  /**
   * POST /v1/responses
   * OpenAI Responses API Compatible Endpoint
   * Creates a new response with support for multi-turn conversations, tool use, and reasoning
   *
   * previous_response_id Handling:
   * Unlike most LLM tools which lack multi-turn state management, this endpoint correctly
   * loads and merges the previous response's output items into the current request context.
   * This enables true stateless multi-turn conversations where the client only sends the
   * new input and the previous_response_id, without needing to re-send all history.
   */
  fastify.post('/v1/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    let usageRecord: Partial<UsageRecord> = {
      requestId,
      date: new Date().toISOString(),
      sourceIp: getClientIp(request),
      incomingApiType: 'responses',
      startTime,
      isStreamed: false,
      responseStatus: 'pending'
    };

    try {
      const body = request.body as any;
      usageRecord.incomingModelAlias = body.model;
      usageRecord.apiKey = (request as any).keyName;
      usageRecord.attribution = (request as any).attribution || null;

      logger.silly('Incoming Responses API Request', body);
      
      const transformer = new ResponsesTransformer();
      
      // Check for previous_response_id and load context
      if (body.previous_response_id) {
        const previousResponse = await responsesStorage.getResponse(body.previous_response_id);
        if (!previousResponse) {
          return reply.code(404).send({
            error: {
              message: `Previous response not found: ${body.previous_response_id}`,
              type: 'invalid_request_error',
              code: 'response_not_found',
              param: 'previous_response_id'
            }
          });
        }

        // Prepend previous output items to input
        const previousItems = JSON.parse(previousResponse.outputItems);
        const currentInput = Array.isArray(body.input) ? body.input : [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: body.input }]
        }];
        body.input = [...previousItems, ...currentInput];
      }

      // Check for conversation and load context
      if (body.conversation) {
        const conversationId = typeof body.conversation === 'string' 
          ? body.conversation 
          : body.conversation.id;
        
        const conversation = await responsesStorage.getConversation(conversationId);
        if (!conversation) {
          return reply.code(404).send({
            error: {
              message: `Conversation not found: ${conversationId}`,
              type: 'invalid_request_error',
              code: 'conversation_not_found',
              param: 'conversation'
            }
          });
        }

        // Prepend conversation items to input
        const conversationItems = JSON.parse(conversation.items);
        const currentInput = Array.isArray(body.input) ? body.input : [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: body.input }]
        }];
        body.input = [...conversationItems, ...currentInput];
      }

      const unifiedRequest = await transformer.parseRequest(body);
      unifiedRequest.incomingApiType = 'responses';
      unifiedRequest.originalBody = body;
      unifiedRequest.requestId = requestId;
      const xAppHeader = Array.isArray(request.headers['x-app'])
        ? request.headers['x-app'][0]
        : request.headers['x-app'];
      if (typeof xAppHeader === 'string' && xAppHeader.trim()) {
        unifiedRequest.metadata = {
          ...(unifiedRequest.metadata || {}),
          clientHeaders: {
            'x-app': xAppHeader
          }
        };
      }

      DebugManager.getInstance().startLog(requestId, body);
      
      const unifiedResponse = await dispatcher.dispatch(unifiedRequest);
      
      // Determine if token estimation is needed
      const shouldEstimateTokens = unifiedResponse.plexus?.config?.estimateTokens || false;
      
      // Capture request metadata
      usageRecord.toolsDefined = body.tools?.length ?? 0;
      // Count messages from the parsed request (normalized from input items)
      usageRecord.messageCount = unifiedRequest.messages?.length ?? 0;
      usageRecord.parallelToolCallsEnabled = body.parallel_tool_calls ?? null;

      const inputItems = Array.isArray(body.input) ? body.input : [];
      const result = await handleResponse(
        request,
        reply,
        unifiedResponse,
        transformer,
        usageRecord,
        usageStorage,
        startTime,
        'responses',
        shouldEstimateTokens,
        body
      );

      // Store response if requested and not streaming
      if (body.store !== false && !body.stream) {
        const formattedResponse = await transformer.formatResponse(unifiedResponse);
        await responsesStorage.storeResponse(formattedResponse, body);

        // Update conversation if specified
        if (body.conversation) {
          const conversationId = typeof body.conversation === 'string'
            ? body.conversation
            : body.conversation.id;
          
          await responsesStorage.updateConversation(
            conversationId,
            formattedResponse.output,
            inputItems
          );
        }
      }

      return result;
    } catch (e: any) {
      usageRecord.responseStatus = 'error';
      usageRecord.durationMs = Date.now() - startTime;
      usageStorage.saveRequest(usageRecord as UsageRecord);

      const errorDetails = {
        apiType: 'responses',
        ...(e.routingContext || {})
      };

      usageStorage.saveError(requestId, e, errorDetails);

      logger.error('Error processing Responses API request', e);
      
      const statusCode = e.routingContext?.statusCode || 500;
      return reply.code(statusCode).send({
        error: {
          message: e.message || 'Internal server error',
          type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
          ...(e.routingContext && {
            routing_context: {
              provider: e.routingContext.provider,
              target_model: e.routingContext.targetModel,
              target_api_type: e.routingContext.targetApiType
            }
          })
        }
      });
    }
  });

  /**
   * GET /v1/responses/:response_id
   * Retrieves a stored response
   */
  fastify.get('/v1/responses/:response_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { response_id } = request.params as { response_id: string };

    try {
      const response = await responsesStorage.getResponse(response_id);
      
      if (!response) {
        return reply.code(404).send({
          error: {
            message: `Response not found: ${response_id}`,
            type: 'invalid_request_error',
            code: 'response_not_found'
          }
        });
      }

      return reply.send(responsesStorage.formatStoredResponse(response));
    } catch (error: any) {
      logger.error(`Error retrieving response ${response_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });

  /**
   * DELETE /v1/responses/:response_id
   * Deletes a stored response
   */
  fastify.delete('/v1/responses/:response_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { response_id } = request.params as { response_id: string };

    try {
      const deleted = await responsesStorage.deleteResponse(response_id);
      
      if (!deleted) {
        return reply.code(404).send({
          error: {
            message: `Response not found: ${response_id}`,
            type: 'invalid_request_error',
            code: 'response_not_found'
          }
        });
      }

      return reply.send({ deleted: true, id: response_id });
    } catch (error: any) {
      logger.error(`Error deleting response ${response_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });

  /**
   * GET /v1/conversations/:conversation_id
   * Retrieves a conversation
   */
  fastify.get('/v1/conversations/:conversation_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { conversation_id } = request.params as { conversation_id: string };

    try {
      const conversation = await responsesStorage.getConversation(conversation_id);
      
      if (!conversation) {
        return reply.code(404).send({
          error: {
            message: `Conversation not found: ${conversation_id}`,
            type: 'invalid_request_error',
            code: 'conversation_not_found'
          }
        });
      }

      return reply.send(responsesStorage.formatStoredConversation(conversation));
    } catch (error: any) {
      logger.error(`Error retrieving conversation ${conversation_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });
}
