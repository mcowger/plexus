import { Transformer } from '../../types/transformer';
import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk
} from '../../types/unified';
import {
  getModel,
  stream,
  complete,
  type OAuthProvider,
  type Model as PiAiModel
} from '@mariozechner/pi-ai';
import {
  applyClaudeCodeToolProxy,
  filterPiAiRequestOptions,
  proxyClaudeCodeToolName
} from '../../filters/pi-ai-request-filters';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import { unifiedToContext, piAiMessageToUnified, piAiEventToChunk } from './type-mappers';
import { logger } from '../../utils/logger';

function streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let closed = false;
  let reading = false;

  return new ReadableStream<T>({
    async pull(controller) {
      if (closed || reading) return;
      reading = true;
      try {
        const { value, done } = await iterator.next();
        if (done) {
          closed = true;
          controller.close();
        } else if (!closed) {
          controller.enqueue(value);
        }
      } catch (error) {
        if (!closed) {
          logger.error('OAuth: Stream pull failed', error as Error);
          closed = true;
          controller.error(error);
        }
      } finally {
        reading = false;
      }
    },
    async cancel(reason) {
      closed = true;
      await iterator.return?.(reason);
    }
  });
}

async function* readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        yield value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function isAsyncIterable<T>(input: any): input is AsyncIterable<T> {
  return input && typeof input[Symbol.asyncIterator] === 'function';
}

function isReadableStream<T>(input: any): input is ReadableStream<T> {
  return !!input && typeof input.getReader === 'function';
}

function describeStreamResult(result: any): Record<string, any> {
  return {
    isPromise: !!result && typeof result.then === 'function',
    isAsyncIterable: isAsyncIterable(result),
    isReadableStream: isReadableStream(result),
    hasIterator: !!result && typeof result[Symbol.asyncIterator] === 'function',
    hasGetReader: !!result && typeof result.getReader === 'function',
    constructorName: result?.constructor?.name || typeof result
  };
}

export class OAuthTransformer implements Transformer {
  readonly name = 'oauth';
  readonly defaultEndpoint = '/v1/chat/completions';
  readonly defaultModel = 'gpt-5-mini';

  protected getPiAiModel(provider: OAuthProvider, modelId: string): PiAiModel<any> {
    return getModel(provider as any, modelId);
  }

  async parseRequest(_input: any): Promise<UnifiedChatRequest> {
    throw new Error(
      `${this.name}: OAuth transformer cannot parse direct client requests. ` +
        `Use OpenAI or Anthropic transformers as entry points.`
    );
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    const context = unifiedToContext(request);
    const options: Record<string, any> = {};

    if (request.reasoning?.effort) {
      options.reasoningEffort = request.reasoning.effort;
    }
    if (request.reasoning?.summary) {
      options.reasoningSummary = request.reasoning.summary;
    }
    if (request.text?.verbosity) {
      options.textVerbosity = request.text.verbosity;
    }
    if (request.prompt_cache_key) {
      options.sessionId = request.prompt_cache_key;
    }
    if (Array.isArray(request.include) && request.include.length > 0) {
      options.include = request.include;
    }
    if (request.max_tokens !== undefined) {
      options.maxTokens = request.max_tokens;
    }
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.tool_choice !== undefined) {
      options.toolChoice = request.tool_choice;
    }
    if (request.parallel_tool_calls !== undefined) {
      options.parallelToolCalls = request.parallel_tool_calls;
    }

    logger.debug(`${this.name}: Converted UnifiedChatRequest to pi-ai Context`, {
      messageCount: context.messages.length,
      hasSystemPrompt: !!context.systemPrompt,
      toolCount: context.tools?.length || 0,
      optionKeys: Object.keys(options)
    });

    return { context, options };
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    logger.silly(`${this.name}: Raw pi-ai response`, response);
    if (response?.stopReason === 'error') {
      const message = response.errorMessage || 'OAuth provider error';
      throw new Error(message);
    }
    const unified = piAiMessageToUnified(response, response.provider, response.model);

    logger.debug(`${this.name}: Converted pi-ai response to unified`, {
      hasContent: !!unified.content,
      hasToolCalls: !!unified.tool_calls,
      usageTokens: unified.usage?.total_tokens
    });

    return unified;
  }

  async formatResponse(): Promise<any> {
    throw new Error(
      `${this.name}: OAuth transformer cannot format responses. ` +
        `Use the original entry transformer for formatting.`
    );
  }

  transformStream(streamInput: ReadableStream | AsyncIterable<any>): ReadableStream {
    const mapped = (async function* () {
      const source = isAsyncIterable<any>(streamInput)
        ? streamInput
        : readableStreamToAsyncIterable(streamInput as ReadableStream<any>);

      for await (const event of source) {
        const provider = event.partial?.provider || event.message?.provider || event.error?.provider;
        const chunk = piAiEventToChunk(event, event.partial?.model || 'unknown', provider);
        if (chunk) {
          yield chunk;
        }
      }
    })();

    return streamFromAsyncIterable(mapped) as ReadableStream<UnifiedChatStreamChunk>;
  }

  formatStream(): ReadableStream {
    throw new Error(
      `${this.name}: OAuth transformer cannot format streams. ` +
        `Use the original entry transformer for formatting.`
    );
  }

  extractUsage(eventData: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const event = JSON.parse(eventData);

      if (event.type === 'done' && event.message?.usage) {
        return {
          input_tokens: event.message.usage.input,
          output_tokens: event.message.usage.output,
          cached_tokens: event.message.usage.cacheRead,
          reasoning_tokens: 0
        };
      }
    } catch {
      // Ignore parse errors
    }

    return undefined;
  }

  async executeRequest(
    context: any,
    provider: OAuthProvider,
    modelId: string,
    streaming: boolean,
    options?: Record<string, any>
  ): Promise<any> {
    const authManager = OAuthAuthManager.getInstance();
    const apiKey = await authManager.getApiKey(provider);
    const model = this.getPiAiModel(provider, modelId);
    const { filteredOptions, strippedParameters } = filterPiAiRequestOptions(options ?? {}, model);
    const isClaudeCodeToken = apiKey.includes('sk-ant-oat');
    const requestOptions: Record<string, any> = { apiKey, ...filteredOptions };

    if (provider === 'anthropic' && isClaudeCodeToken) {
      applyClaudeCodeToolProxy(context);

      if (requestOptions.toolChoice) {
        if (typeof requestOptions.toolChoice === 'string') {
          requestOptions.toolChoice = proxyClaudeCodeToolName(requestOptions.toolChoice);
        } else if (typeof requestOptions.toolChoice === 'object') {
          if (typeof requestOptions.toolChoice.name === 'string') {
            requestOptions.toolChoice.name = proxyClaudeCodeToolName(requestOptions.toolChoice.name);
          }
          if (requestOptions.toolChoice.function?.name) {
            requestOptions.toolChoice.function.name = proxyClaudeCodeToolName(
              requestOptions.toolChoice.function.name
            );
          }
        }
      }

      const claudeCodeHeaders = {
        accept: 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta':
          'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14',
        'user-agent': 'claude-cli/2.1.2 (external, cli)',
        'x-app': 'cli'
      };

      requestOptions.headers = {
        ...claudeCodeHeaders,
        ...(filteredOptions as any).headers
      };
    }

    const apiKeyPreview = apiKey ? `${apiKey.slice(0, 12)}...` : 'none';

    logger.debug(`${this.name}: OAuth credentials resolved`, {
      provider,
      model: model.id,
      streaming,
      apiKeyPreview,
      isClaudeCodeToken,
      optionKeys: Object.keys(filteredOptions),
      hasInjectedClaudeCodeHeaders: !!requestOptions.headers
    });

    if (strippedParameters.length > 0) {
      logger.debug(`${this.name}: Stripped pi-ai request options`, {
        model: model.id,
        provider,
        strippedParameters
      });
    }

    logger.info(`${this.name}: Executing ${streaming ? 'streaming' : 'complete'} request`, {
      model: model.id,
      provider
    });

    if (streaming) {
      try {
        const result = await stream(model, context, requestOptions);
        logger.debug(`${this.name}: OAuth stream result type`, describeStreamResult(result));
        return result;
      } catch (error) {
        logger.error(`${this.name}: OAuth stream request failed`, error);
        throw error;
      }
    }

    return await complete(model, context, requestOptions);
  }
}
