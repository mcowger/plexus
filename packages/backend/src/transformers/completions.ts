import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { normalizeOpenAIChatUsage } from '../utils/usage-normalizer';
import { getApiBaseType } from '../utils/api-format';

/**
 * OpenAICompletionTransformer
 * Handles /v1/completions (and /completions) text completion requests.
 * Supports direct completion passthrough to completion models as well as
 * automatic translation to chat model formats when target API type is chat/messages/gemini.
 */
export class OpenAICompletionTransformer implements Transformer {
  name = 'completions';
  defaultEndpoint = '/completions';

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    const rawPrompt = input.prompt;
    const promptText = Array.isArray(rawPrompt)
      ? rawPrompt.map((p) => (typeof p === 'string' ? p : String(p))).join('\n')
      : typeof rawPrompt === 'string'
        ? rawPrompt
        : rawPrompt != null
          ? String(rawPrompt)
          : '';

    const suffixText = typeof input.suffix === 'string' ? input.suffix : null;

    // Build fallback messages for chat-based providers
    const systemPrompt = suffixText
      ? 'You are an inline code completion assistant. Your task is to generate ONLY the code or text that replaces <FILL_HERE>. Do NOT surround output in backticks or markdown formatting. Output raw completion text only.'
      : 'You are an inline code completion assistant. Continue the code or text seamlessly from the prompt. Do NOT surround output in backticks or markdown formatting. Output raw completion text only.';

    const userContent = suffixText
      ? `Prefix:\n${promptText}\n\nSuffix:\n${suffixText}\n\nCode to insert at <FILL_HERE>:`
      : promptText;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userContent },
    ];

    return {
      messages,
      prompt: promptText,
      suffix: suffixText,
      model: input.model,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      stream: input.stream,
      echo: input.echo,
      logprobs: input.logprobs,
      best_of: input.best_of,
      stop: input.stop,
      presence_penalty: input.presence_penalty,
      frequency_penalty: input.frequency_penalty,
      seed: input.seed,
      user: input.user,
      incomingApiType: 'completions',
      originalBody: input,
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    const outgoingApiType = request.metadata?.plexus_metadata ? undefined : undefined; // determined dynamically
    const isSameApiType =
      request.originalBody && request.incomingApiType?.toLowerCase() === 'completions';

    // If target provider expects completion format directly
    const isCompletionTarget =
      isSameApiType || request.prompt !== undefined || request.originalBody?.prompt !== undefined;

    if (isSameApiType) {
      const out = { ...request.originalBody };
      out.model = request.model;
      if (request.max_tokens !== undefined) out.max_tokens = request.max_tokens;
      if (request.temperature !== undefined) out.temperature = request.temperature;
      if (request.stream !== undefined) out.stream = request.stream;
      return out;
    }

    // Direct completion payload construction
    return {
      model: request.model,
      prompt: request.prompt ?? '',
      suffix: request.suffix ?? undefined,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.originalBody?.top_p,
      n: request.originalBody?.n,
      stream: request.stream,
      stop: request.stop,
      logprobs: request.logprobs,
      echo: request.echo,
      best_of: request.best_of,
      presence_penalty: request.presence_penalty,
      frequency_penalty: request.frequency_penalty,
      seed: request.seed,
      user: request.user,
      ...(request.originalBody?.stream_options
        ? { stream_options: request.originalBody.stream_options }
        : {}),
    };
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const choice = response.choices?.[0];
    const textContent =
      choice?.text !== undefined
        ? choice.text
        : choice?.message?.content !== undefined
          ? choice.message.content
          : null;

    const usage = response.usage ? normalizeOpenAIChatUsage(response.usage) : undefined;

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      content: textContent,
      usage,
      finishReason: choice?.finish_reason || null,
    };
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    return {
      id: response.id || `cmpl-${crypto.randomUUID()}`,
      object: 'text_completion',
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          text: response.content || '',
          index: 0,
          logprobs: null,
          finish_reason: response.finishReason || 'stop',
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens + (response.usage.cached_tokens || 0),
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();

    return new ReadableStream({
      async start(controller) {
        const parser = createParser({
          onEvent: (event: EventSourceMessage) => {
            if (event.data === '[DONE]') return;

            try {
              const data = JSON.parse(event.data);
              const choice = data.choices?.[0];
              const usage = data.usage ? normalizeOpenAIChatUsage(data.usage) : undefined;

              const textDelta =
                choice?.text !== undefined
                  ? choice.text
                  : choice?.delta?.content !== undefined
                    ? choice.delta.content
                    : '';

              const unifiedChunk = {
                id: data.id,
                model: data.model,
                created: data.created,
                delta: {
                  content: textDelta,
                },
                finish_reason: choice?.finish_reason || data.finish_reason || null,
                usage,
              };

              controller.enqueue(unifiedChunk);
            } catch (e) {
              // ignore parse errors
            }
          },
        });

        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
  }

  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();
    const reader = stream.getReader();

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value: unifiedChunk } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode(encode({ data: '[DONE]' })));
              break;
            }

            const choice: any = {
              text: unifiedChunk.delta?.content || '',
              index: 0,
              logprobs: null,
              finish_reason: unifiedChunk.finish_reason || null,
            };

            const chunk: any = {
              id: unifiedChunk.id || `cmpl-${crypto.randomUUID()}`,
              object: 'text_completion',
              created: unifiedChunk.created || Math.floor(Date.now() / 1000),
              model: unifiedChunk.model,
              choices: [choice],
            };

            if (unifiedChunk.usage) {
              chunk.usage = {
                prompt_tokens:
                  unifiedChunk.usage.input_tokens + (unifiedChunk.usage.cached_tokens || 0),
                completion_tokens: unifiedChunk.usage.output_tokens,
                total_tokens: unifiedChunk.usage.total_tokens,
              };
            }

            controller.enqueue(encoder.encode(encode({ data: JSON.stringify(chunk) })));
          }
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });
  }

  extractUsage(dataStr: string):
    | {
        input_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_creation_tokens?: number;
        reasoning_tokens?: number;
      }
    | undefined {
    try {
      const data = JSON.parse(dataStr);
      if (data.usage) {
        const usage = normalizeOpenAIChatUsage(data.usage);
        return {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cached_tokens: usage.cached_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
          reasoning_tokens: usage.reasoning_tokens,
        };
      }
    } catch (e) {
      // Ignore
    }

    return undefined;
  }
}
