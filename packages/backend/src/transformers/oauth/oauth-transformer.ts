import { Transformer } from '../../types/transformer';
import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk,
} from '../../types/unified';
import { getModel, stream, complete, type Model as PiAiModel } from '@mariozechner/pi-ai';
import type { OAuthProvider } from '@mariozechner/pi-ai/oauth';
import {
  applyClaudeCodeToolProxy,
  filterPiAiRequestOptions,
  proxyClaudeCodeToolName,
} from '../../filters/pi-ai-request-filters';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import {
  unifiedToContext,
  piAiMessageToUnified,
  piAiEventToChunk,
  extractPiAiErrorMessage,
} from './type-mappers';
import { logger } from '../../utils/logger';

/**
 * Returns the pi-ai request options needed to enable thinking/reasoning for a given
 * model API and effort level.  Each pi-ai stream implementation uses different field
 * names:
 *
 * - anthropic-messages  → thinkingEnabled + (effort | thinkingBudgetTokens)
 * - openai-responses /
 *   openai-codex-responses → reasoningEffort
 * - google-gemini-cli Gemini 3   → thinking.level
 * - everything else (Gemini 2.x) → thinking.budgetTokens
 *
 * `reasoning` is always included for streamSimple* compatibility.
 */
function buildThinkingOptions(
  modelApi: string | undefined,
  modelId: string | undefined,
  effort: string,
  maxTokens?: number,
  summary?: string,
  textVerbosity?: string
): Record<string, any> {
  const BUDGET: Record<string, number> = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  };

  // streamSimple compatibility — always included regardless of API type
  const base: Record<string, any> = { reasoning: effort };

  if (
    modelApi === 'openai-responses' ||
    modelApi === 'openai-codex-responses' ||
    modelApi === 'openai-completions'
  ) {
    // streamOpenAIResponses / streamOpenAICodexResponses / streamOpenAICompletions
    // all check `options.reasoningEffort` when called via stream()
    base.reasoningEffort = effort;
    if (summary) base.reasoningSummary = summary;
    if (textVerbosity) base.textVerbosity = textVerbosity;
    return base;
  }

  if (modelApi === 'anthropic-messages') {
    // streamAnthropic checks `options.thinkingEnabled` (boolean) plus either
    // `options.effort` (adaptive models) or `options.thinkingBudgetTokens` (older models)
    const isAdaptive =
      modelId?.includes('opus-4-6') ||
      modelId?.includes('opus-4.6') ||
      modelId?.includes('sonnet-4-6') ||
      modelId?.includes('sonnet-4.6');

    base.thinkingEnabled = true;
    if (isAdaptive) {
      const effortMap: Record<string, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: modelId?.includes('opus-4-6') || modelId?.includes('opus-4.6') ? 'max' : 'high',
      };
      base.effort = effortMap[effort] ?? 'high';
    } else {
      base.thinkingBudgetTokens = maxTokens ?? BUDGET[effort] ?? 16384;
    }
    return base;
  }

  // Gemini providers use `options.thinking` object
  const isGemini3 = modelId?.includes('3-pro') || modelId?.includes('3-flash');
  if (isGemini3) {
    const levelMap: Record<string, string> = {
      minimal: 'MINIMAL',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
    };
    base.thinking = { enabled: true, level: levelMap[effort] ?? 'HIGH' };
  } else {
    base.thinking = { enabled: true, budgetTokens: maxTokens ?? BUDGET[effort] ?? 16384 };
  }
  return base;
}

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
    },
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
    constructorName: result?.constructor?.name || typeof result,
  };
}

export class OAuthTransformer implements Transformer {
  readonly name = 'oauth';
  readonly defaultEndpoint = '/v1/chat/completions';
  readonly defaultModel = 'gpt-5-mini';

  protected getPiAiModel(provider: OAuthProvider, modelId: string): PiAiModel<any> {
    return getModel(provider as any, modelId);
  }

  private async resolveApiKey(
    provider: OAuthProvider,
    auth: { authMode: 'oauth'; accountId: string } | { authMode: 'apiKey'; apiKey: string }
  ): Promise<string> {
    if (auth.authMode === 'apiKey') {
      return auth.apiKey;
    }

    const authManager = OAuthAuthManager.getInstance();
    return authManager.getApiKey(provider, auth.accountId);
  }

  async parseRequest(_input: any): Promise<UnifiedChatRequest> {
    throw new Error(
      `${this.name}: OAuth transformer cannot parse direct client requests. ` +
        `Use OpenAI or Anthropic transformers as entry points.`
    );
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    const oauthProvider = (request.metadata as any)?.plexus_metadata?.oauthProvider;

    // Resolve the pi-ai model's `api` field so that replayed assistant messages
    // carry the correct api value.  pi-ai's transformMessages checks provider+api+model
    // and strips thoughtSignatures when any field doesn't match.
    let modelApi: string | undefined;
    let modelSupportsReasoning = false;
    if (oauthProvider && request.model) {
      try {
        const piModel = this.getPiAiModel(oauthProvider as any, request.model);
        modelApi = piModel.api;
        modelSupportsReasoning = !!(piModel as any).reasoning;
      } catch {
        // Model lookup can fail for unknown providers/models; fall back gracefully
      }
    }

    const context = unifiedToContext(request, oauthProvider, request.model, modelApi);
    const options: Record<string, any> = {};
    const clientHeaders = (request.metadata as any)?.plexus_metadata?.clientHeaders;
    if (clientHeaders && typeof clientHeaders === 'object') {
      options.clientHeaders = clientHeaders;
    }

    // Determine the desired thinking effort level
    let thinkingEffort: string | undefined;
    if (request.reasoning?.enabled || request.reasoning?.effort) {
      thinkingEffort = request.reasoning.effort ?? 'high';
    } else if (modelSupportsReasoning) {
      // Client didn't request reasoning (e.g. Copilot doesn't send thinking params),
      // but the model supports it — enable it at high effort by default so the model
      // reasons correctly and produces schema-compliant tool call arguments.
      logger.debug(
        `${this.name}: Model supports reasoning but client did not request it; defaulting to 'high'`
      );
      thinkingEffort = 'high';
    }

    if (thinkingEffort) {
      Object.assign(
        options,
        buildThinkingOptions(
          modelApi,
          request.model,
          thinkingEffort,
          request.reasoning?.max_tokens,
          request.reasoning?.summary,
          request.text?.verbosity
        )
      );
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
      optionKeys: Object.keys(options),
    });

    return { context, options };
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    logger.silly(`${this.name}: Raw pi-ai response`, response);
    const piAiError = getPiAiErrorResponse(response);
    if (piAiError) {
      const error = new Error(piAiError.message) as Error & { piAiResponse?: unknown };
      error.piAiResponse = piAiError.payload;
      throw error;
    }
    const unified = piAiMessageToUnified(response, response.provider, response.model);

    logger.debug(`${this.name}: Converted pi-ai response to unified`, {
      hasContent: !!unified.content,
      hasToolCalls: !!unified.tool_calls,
      usageTokens: unified.usage?.total_tokens,
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
        if (!event || typeof event.type !== 'string') {
          continue;
        }

        const provider =
          event.partial?.provider || event.message?.provider || event.error?.provider;
        const eventModel =
          event.partial?.model || event.message?.model || event.error?.model || 'unknown';
        const chunk = piAiEventToChunk(event, eventModel, provider);
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
        cache_creation_tokens?: number;
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
          cache_creation_tokens: event.message.usage.cacheWrite,
          reasoning_tokens: 0,
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
    options?: Record<string, any>,
    auth: { authMode: 'oauth'; accountId: string } | { authMode: 'apiKey'; apiKey: string } = {
      authMode: 'oauth',
      accountId: '',
    }
  ): Promise<any> {
    const rawApiKey = await this.resolveApiKey(provider, auth);
    // pi-ai enables Claude Code identity/system injection only for OAuth-shaped tokens.
    // For masked API-key mode, provide a shim token to select that code path while
    // still sending the real key via x-api-key for Anthropic authentication.
    const apiKey =
      provider === 'anthropic' && auth.authMode === 'apiKey'
        ? `sk-ant-oat-mask-${rawApiKey}`
        : rawApiKey;
    const usesClaudeCodeOAuthShim =
      provider === 'anthropic' && auth.authMode === 'apiKey' && apiKey.includes('sk-ant-oat');
    const model = { ...this.getPiAiModel(provider, modelId) };

    // GitHub Copilot Business account fix:
    // pi-ai extracts proxy-ep from the token and incorrectly derives api.business.githubcopilot.com
    // as the baseUrl. This endpoint only supports NES/autocomplete. Chat/Claude models must
    // use the standard api.githubcopilot.com endpoint.
    if (
      provider === 'github-copilot' &&
      apiKey.includes('proxy-ep=proxy.business.githubcopilot.com')
    ) {
      logger.debug(`${this.name}: GitHub Business account detected; forcing standard API endpoint`);
      model.baseUrl = 'https://api.githubcopilot.com';
    }

    const rawOptions = { ...(options ?? {}) };
    const clientHeaders = rawOptions.clientHeaders as Record<string, unknown> | undefined;
    delete rawOptions.clientHeaders;
    const { filteredOptions, strippedParameters } = filterPiAiRequestOptions(rawOptions, model);
    const isClaudeCodeToken = apiKey.includes('sk-ant-oat');
    const requestOptions: Record<string, any> = { apiKey, ...filteredOptions };
    let userAgent = '';
    if (provider === 'openai-codex') {
      userAgent = 'codex_cli_rs/0.101.0 (Debian 13.0.0; x86_64) WindowsTerminal';
    }

    const baseHeaders: Record<string, string> = {
      ...((filteredOptions as any).headers as Record<string, string>),
      Version: '0.101.0',
      ...(provider === 'anthropic' && auth.authMode === 'apiKey' ? { 'x-api-key': rawApiKey } : {}),
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    };

    requestOptions.headers = baseHeaders;
    const isClaudeCodeAgent =
      typeof clientHeaders?.['x-app'] === 'string' &&
      clientHeaders['x-app'].toLowerCase() === 'cli';

    if (provider === 'anthropic' && (isClaudeCodeToken || auth.authMode === 'apiKey')) {
      if (!isClaudeCodeAgent) {
        applyClaudeCodeToolProxy(context);

        if (requestOptions.toolChoice) {
          if (typeof requestOptions.toolChoice === 'string') {
            requestOptions.toolChoice = proxyClaudeCodeToolName(requestOptions.toolChoice);
          } else if (typeof requestOptions.toolChoice === 'object') {
            if (typeof requestOptions.toolChoice.name === 'string') {
              requestOptions.toolChoice.name = proxyClaudeCodeToolName(
                requestOptions.toolChoice.name
              );
            }
            if (requestOptions.toolChoice.function?.name) {
              requestOptions.toolChoice.function.name = proxyClaudeCodeToolName(
                requestOptions.toolChoice.function.name
              );
            }
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
        'x-app': 'cli',
      };

      requestOptions.headers = {
        ...claudeCodeHeaders,
        ...baseHeaders,
      };
    }

    const apiKeyPreview = apiKey ? `${apiKey.slice(0, 12)}...` : 'none';

    logger.debug(`${this.name}: OAuth credentials resolved`, {
      provider,
      accountId: auth.authMode === 'oauth' ? auth.accountId : undefined,
      authMode: auth.authMode,
      model: model.id,
      streaming,
      apiKeyPreview,
      isClaudeCodeToken,
      usesClaudeCodeOAuthShim,
      hasRawAnthropicApiKeyHeader:
        provider === 'anthropic' &&
        auth.authMode === 'apiKey' &&
        !!requestOptions.headers?.['x-api-key'],
      isClaudeCodeAgent,
      optionKeys: Object.keys(filteredOptions),
      hasInjectedClaudeCodeHeaders: !!requestOptions.headers,
    });

    if (strippedParameters.length > 0) {
      logger.debug(`${this.name}: Stripped pi-ai request options`, {
        model: model.id,
        provider,
        accountId: auth.authMode === 'oauth' ? auth.accountId : undefined,
        strippedParameters,
      });
    }

    // Log the actual HTTP payload pi-ai sends so we can verify tool schemas
    requestOptions.onPayload = (payload: any) => {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      logger.info(`${this.name}: FULL-OUTGOING-PAYLOAD ${payloadStr}`);
    };

    logger.info(
      `${this.name}: Executing ${streaming ? 'streaming' : 'complete'} request { model: "${model.id}", provider: "${provider}", authMode: "${auth.authMode}"${auth.authMode === 'oauth' ? `, accountId: "${auth.accountId}"` : ''} }`
    );

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

function getPiAiErrorResponse(response: any): { message: string; payload: unknown } | null {
  if (!response) {
    return null;
  }

  if (response?.stopReason === 'error') {
    return {
      message:
        response.errorMessage || extractPiAiErrorMessage(response.error) || 'OAuth provider error',
      payload: response,
    };
  }

  if (response?.type === 'error' || response?.reason === 'error') {
    return {
      message:
        extractPiAiErrorMessage(response.error) ||
        response.errorMessage ||
        extractPiAiErrorMessage(response) ||
        'OAuth provider error',
      payload: response,
    };
  }

  return null;
}
