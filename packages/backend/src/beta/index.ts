/**
 * Beta inference route.
 *
 * POST /beta/v1/chat/completions — a parallel inference path that drives pi-ai
 * directly, bypassing the legacy Transformer / UnifiedChatRequest machinery.
 *
 * Sits behind the same bearer-auth as the existing /v1/chat/completions route.
 * Out of scope (first cut): quota enforcement, failover/cooldowns, stall detection.
 */
import type { FastifyInstance } from 'fastify';
import { UsageStorageService } from '../services/usage-storage';
import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../utils/timeout';
import { getClientIp } from '../utils/ip';
import { logger } from '../utils/logger';
import { DebugManager } from '../services/debug-manager';
import { sanitizeHeaders } from '../utils/sanitize-headers';
import { runBeta } from './run';
import type { OpenAIChatRequest } from './openai-to-context';

export async function registerBetaRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService
) {
  fastify.post('/beta/v1/chat/completions', async (request, reply) => {
    const requestId = crypto.randomUUID();
    reply.header('x-request-id', requestId);
    const startTime = Date.now();

    const body = request.body as OpenAIChatRequest;

    // Log debug preamble (mirrors chat.ts)
    DebugManager.getInstance().startLog(requestId, body, sanitizeHeaders(request.headers as any));

    logger.silly('Beta: incoming request', body);

    const abortController = new AbortController();
    const { signal } = wireUpstreamTimeout(abortController);
    const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);

    try {
      const result = await runBeta(body, requestId, request, usageStorage, signal);

      if (result.stream) {
        // Streaming response: write SSE frames as they arrive
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        // Consume the async generator into a Web ReadableStream that Fastify can send
        const readableStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const enc = new TextEncoder();
              for await (const frame of result.stream!) {
                controller.enqueue(enc.encode(frame));
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
        });

        earlyDisconnect.cleanup();
        return reply.send(readableStream);
      }

      // Non-streaming: send the JSON completion
      earlyDisconnect.cleanup();
      return reply.send(result.response);
    } catch (e: any) {
      earlyDisconnect.cleanup();

      if (e?.routingContext?.code === 'client_disconnected') {
        logger.info(`Beta: request ${requestId} cancelled (client disconnected)`);
        return;
      }

      logger.error(`Beta: error processing request ${requestId}`, e);

      const statusCode = e.routingContext?.statusCode ?? 500;
      const errorCode = e.routingContext?.code;
      const errorType =
        statusCode === 401
          ? 'authentication_error'
          : statusCode === 400
            ? 'invalid_request_error'
            : 'api_error';

      return reply.code(statusCode).send({
        error: {
          message: e.message,
          type: errorType,
          ...(errorCode ? { code: errorCode } : {}),
        },
      });
    }
  });
}
