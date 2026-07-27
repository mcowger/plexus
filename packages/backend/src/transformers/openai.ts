import { Transformer } from '../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse } from '../types/unified';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';
import { normalizeOpenAIChatUsage } from '../utils/usage-normalizer';
import { GEMINI_MALFORMED_FUNCTION_CALL_CODE } from '../utils/gemini-malformed-function-call';

/**
 * OpenAITransformer
 */
export class OpenAITransformer implements Transformer {
  name = 'chat';
  defaultEndpoint = '/chat/completions';

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Normalize assistant messages that carry OpenAI-style `reasoning_content`:
    // 1. Convert `reasoning_content` → `thinking` blocks (pi-ai internal format)
    // 2. Convert string `content` → array of content parts so pi-ai's
    //    `transformMessages` can safely call `flatMap` on it.
    // Without this, the second request in a multi-turn conversation crashes
    // with `assistantMsg.content.flatMap is not a function`.
    const messages = Array.isArray(input.messages)
      ? input.messages.map((msg: any) => {
          if (
            msg.role === 'assistant' &&
            msg.reasoning_content !== undefined &&
            msg.reasoning_content !== null
          ) {
            const { reasoning_content, ...rest } = msg;
            const reasoningText = typeof reasoning_content === 'string' ? reasoning_content : '';
            // Ensure content is an array of content parts for pi-ai compatibility
            const normalizedContent =
              typeof rest.content === 'string'
                ? rest.content
                  ? [{ type: 'text' as const, text: rest.content }]
                  : []
                : Array.isArray(rest.content)
                  ? rest.content
                  : [];
            return {
              ...rest,
              content: normalizedContent,
              thinking: msg.thinking || { content: reasoningText },
            };
          }
          return msg;
        })
      : input.messages;

    return {
      messages,
      model: input.model,
      max_tokens: input.max_tokens,
      temperature: input.temperature,
      stream: input.stream,
      tools: input.tools,
      tool_choice: input.tool_choice,
      reasoning: input.reasoning,
    };
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Prepend systemInstruction as a system message if present
    const messages =
      request.systemInstruction && request.systemInstruction.content
        ? [{ role: 'system', content: request.systemInstruction.content }, ...request.messages]
        : request.messages;

    // Normalize tools: map parametersJsonSchema -> parameters for OpenAI format.
    const normalizedTools =
      request.tools && request.tools.length > 0
        ? request.tools.map((t: any) => {
            if (t.type !== 'function' || !t.function) return t;
            const fn = t.function;
            // If parametersJsonSchema is present, prefer it over parameters
            const parameters = fn.parametersJsonSchema ?? fn.parameters;
            return {
              type: 'function',
              function: {
                name: fn.name,
                description: fn.description,
                parameters,
              },
            };
          })
        : undefined;

    // When the incoming API type matches our outgoing type (chat -> chat),
    // start from the original body to preserve unknown fields (e.g.
    // enable_thinking, chat_template_kwargs, budget_tokens) that the
    // explicit mapping below would otherwise drop. The explicitly-mapped
    // fields are then overlaid on top to apply any necessary transformations.
    // Cross-API transformations (chat -> messages, chat -> gemini) remain
    // fully explicit since they're fundamentally different protocols.
    const isSameApiType = request.originalBody && request.incomingApiType?.toLowerCase() === 'chat';

    const out: any = isSameApiType ? { ...request.originalBody } : {};

    // Override with explicitly-transformed fields
    out.model = request.model;
    out.messages = messages;
    out.max_tokens = request.max_tokens;
    out.temperature = request.temperature;
    out.stream = request.stream;
    out.tools = normalizedTools && normalizedTools.length > 0 ? normalizedTools : undefined;
    out.tool_choice = request.tool_choice;

    if (request.response_format) {
      if (request.response_format.type === 'json_schema' && request.response_format.json_schema) {
        // OpenAI json_schema mode requires {name, schema, strict} wrapping.
        // The client-supplied descriptor (carried on the unified
        // response_format — see types/unified.ts) wins; the fabricated
        // `response_schema` / `strict: true` values are fallbacks ONLY for
        // clients that omitted them (`?? `— an explicit strict: false must
        // survive).
        out.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.response_format.name ?? 'response_schema',
            ...(request.response_format.description !== undefined
              ? { description: request.response_format.description }
              : {}),
            schema: request.response_format.json_schema,
            strict: request.response_format.strict ?? true,
          },
        };
      } else {
        out.response_format = request.response_format;
      }
    }

    if (request.reasoning) {
      out.reasoning = request.reasoning;
    }

    if (request.parallel_tool_calls !== undefined) {
      out.parallel_tool_calls = request.parallel_tool_calls;
    }

    return out;
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    const choice = response.choices?.[0];
    const message = choice?.message;

    const usage = response.usage ? normalizeOpenAIChatUsage(response.usage) : undefined;

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      content: message?.content || null,
      reasoning_content: message?.reasoning_content ?? message?.reasoning ?? null,
      tool_calls: message?.tool_calls,
      usage,
      finishReason: choice?.finish_reason || null,
    };
  }

  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    // Return content as a plain string per the OpenAI Chat Completions spec:
    // `content` is a string, `reasoning_content` is a separate top-level field.
    // The `flatMap` crash on subsequent turns is handled in `parseRequest`,
    // which normalizes incoming assistant messages into pi-ai's array format.
    const message: any = {
      role: 'assistant',
      content: response.content,
      reasoning_content: response.reasoning_content,
      tool_calls: response.tool_calls,
      ...(response.annotations && response.annotations.length > 0
        ? { annotations: response.annotations }
        : {}),
    };

    return {
      id: response.id,
      object: 'chat.completion',
      created: response.created || Math.floor(Date.now() / 1000),
      model: response.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: response.tool_calls ? 'tool_calls' : 'stop',
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens + (response.usage.cached_tokens || 0),
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
            prompt_tokens_details: response.usage.cached_tokens
              ? { cached_tokens: response.usage.cached_tokens }
              : null,
            reasoning_tokens: response.usage.reasoning_tokens,
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

              const unifiedChunk = {
                id: data.id,
                model: data.model,
                created: data.created,
                delta: {
                  role: choice?.delta?.role,
                  content: choice?.delta?.content,
                  reasoning_content: choice?.delta?.reasoning_content ?? choice?.delta?.reasoning,
                  tool_calls: choice?.delta?.tool_calls,
                },
                finish_reason:
                  choice?.finish_reason || data.finish_reason || (choice?.delta ? null : 'stop'),
                usage,
              };

              controller.enqueue(unifiedChunk);
            } catch (e) {
              // ignore
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
    let hasSentError = false;
    // Only the legacy Gemini MALFORMED_FUNCTION_CALL defect (a transient,
    // retry-worthy signal — see utils/gemini-malformed-function-call.ts)
    // intentionally ends the stream WITHOUT `[DONE]`, so it reads as an
    // aborted stream rather than a clean finish. Any other upstream error
    // (Anthropic mid-stream error, Responses response.failed/error) is a
    // genuine terminal condition and should still close cleanly with
    // `[DONE]` so OpenAI-compatible clients don't hang waiting for one.
    let suppressDone = false;
    // Tracks whether any terminal signal (a real finish_reason chunk, an
    // error chunk rendered as a normal finish, or the hard-error JSON
    // payload) has already reached the client, so the end-of-stream flush
    // below never synthesizes a redundant one.
    let hasSentFinish = false;
    // Some OpenAI-compatible upstreams (and Plexus itself, for Copilot-native
    // streaming — see services/oauth/oauth-native-request.ts) request
    // `stream_options.include_usage`, which sends a trailing
    // `{choices: [], usage: {...}}` frame AFTER the real finish chunk.
    // transformStream has no real choice to read there, so it can't tell
    // that frame apart from a genuinely empty/terminal chunk — this flag lets
    // exactly one such trailing usage frame still reach the client even
    // though a terminal signal was already sent, without reopening the door
    // for a second finish_reason or error chunk.
    let hasForwardedTrailingUsage = false;
    let lastChunkId: string | undefined;
    let lastChunkModel: string | undefined;

    const isEmptyDelta = (delta: any): boolean =>
      !delta || (!delta.role && !delta.content && !delta.reasoning_content && !delta.tool_calls);

    const buildChatUsagePayload = (usage: any) =>
      usage
        ? {
            prompt_tokens: usage.input_tokens + (usage.cached_tokens || 0),
            completion_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
            prompt_tokens_details: usage.cached_tokens
              ? { cached_tokens: usage.cached_tokens }
              : null,
            reasoning_tokens: usage.reasoning_tokens,
          }
        : undefined;

    return new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value: unifiedChunk } = await reader.read();
            if (done) {
              if (!hasSentFinish) {
                // Source ended without ever emitting a finish_reason
                // (upstream aborted, error dropped upstream of us, or zero
                // parsable events): synthesize one so OpenAI-compatible
                // clients never see a stream with no stop chunk.
                //
                // With ZERO parsable chunks there is no upstream id to echo,
                // so synthesize one (this file has no id-generation
                // convention of its own; `chatcmpl_` matches the OpenAI wire
                // prefix). No `model` is synthesized in that case: this
                // formatter's only input is the unified chunk stream itself
                // — it has no request context — so when no chunk ever
                // arrived the model is genuinely unknowable here, and the
                // field is omitted (JSON drops the undefined) rather than
                // fabricated.
                controller.enqueue(
                  encoder.encode(
                    encode({
                      data: JSON.stringify({
                        id: lastChunkId ?? `chatcmpl_${crypto.randomUUID()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: lastChunkModel,
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                      }),
                    })
                  )
                );
              }
              if (!suppressDone) {
                controller.enqueue(encoder.encode(encode({ data: '[DONE]' })));
              }
              break;
            }

            if (hasSentError) continue;

            lastChunkId = unifiedChunk.id ?? lastChunkId;
            lastChunkModel = unifiedChunk.model ?? lastChunkModel;

            // Once any terminal signal has been rendered — a hard-error
            // payload OR an error-channel chunk rendered as a normal finish
            // (e.g. the `length` case below) — close the door on everything
            // else so a stray/duplicate chunk can never produce a second
            // terminal payload. Mirrors the unconditional single-latch
            // pattern used by the sibling formatters (formatAnthropicStream's
            // `hasSentFinish` guard, formatGeminiStream's `hasSentError`
            // guard). The one carved-out exception is a single trailing
            // usage-only frame (see `hasForwardedTrailingUsage` above):
            // rendered without a finish_reason (whatever transformStream put
            // there, fabricated or not, is ignored) since it is metadata, not
            // a second finish.
            if (hasSentFinish) {
              const isTrailingUsageOnly =
                !hasForwardedTrailingUsage &&
                unifiedChunk.event !== 'error' &&
                !!unifiedChunk.usage &&
                isEmptyDelta(unifiedChunk.delta);

              if (!isTrailingUsageOnly) continue;

              hasForwardedTrailingUsage = true;
              const usagePayload = buildChatUsagePayload(unifiedChunk.usage);
              controller.enqueue(
                encoder.encode(
                  encode({
                    data: JSON.stringify({
                      id: unifiedChunk.id,
                      object: 'chat.completion.chunk',
                      created: unifiedChunk.created || Math.floor(Date.now() / 1000),
                      model: unifiedChunk.model,
                      choices: [],
                      ...(usagePayload ? { usage: usagePayload } : {}),
                    }),
                  })
                )
              );
              continue;
            }

            if (unifiedChunk.event === 'error') {
              if (unifiedChunk.finish_reason) {
                // A recognizable, non-fatal finish (e.g. Responses
                // `response.incomplete` with reason `max_output_tokens` or
                // `content_filter`) was carried through the error-chunk
                // channel; render it as a normal finish instead of an error
                // payload. Forward any final usage the upstream attached to
                // this same chunk (see responses.ts transformStream) using
                // the same usage-shaping helper as everywhere else in this
                // file, so chat-format clients still receive it.
                const usagePayload = buildChatUsagePayload(unifiedChunk.usage);
                controller.enqueue(
                  encoder.encode(
                    encode({
                      data: JSON.stringify({
                        id: unifiedChunk.id,
                        object: 'chat.completion.chunk',
                        created: unifiedChunk.created || Math.floor(Date.now() / 1000),
                        model: unifiedChunk.model,
                        choices: [
                          { index: 0, delta: {}, finish_reason: unifiedChunk.finish_reason },
                        ],
                        ...(usagePayload ? { usage: usagePayload } : {}),
                      }),
                    })
                  )
                );
                hasSentFinish = true;
                continue;
              }

              // The legacy Gemini MALFORMED_FUNCTION_CALL defect keeps its
              // existing, specific rendering (downstream/clients may already
              // key off this exact code) and its [DONE]-suppression. Any
              // other hard error (Anthropic mid-stream error, Responses
              // response.failed/error, or anything else routed through this
              // channel) propagates its own upstream code instead of being
              // mislabeled with Gemini's — falling back to a neutral generic
              // only when the upstream genuinely didn't supply one.
              const isLegacyGeminiMalformedCall =
                unifiedChunk.error?.code === GEMINI_MALFORMED_FUNCTION_CALL_CODE;
              // Same final-usage forwarding as the recognizable-finish
              // branch above — a hard failure (e.g. Responses
              // response.failed) can still carry final usage.
              const usagePayload = buildChatUsagePayload(unifiedChunk.usage);

              controller.enqueue(
                encoder.encode(
                  encode({
                    data: JSON.stringify({
                      error: {
                        message: unifiedChunk.error?.message,
                        type: 'server_error',
                        code: isLegacyGeminiMalformedCall
                          ? 'upstream_malformed_function_call'
                          : unifiedChunk.error?.code || 'upstream_error',
                      },
                      ...(usagePayload ? { usage: usagePayload } : {}),
                    }),
                  })
                )
              );
              hasSentError = true;
              hasSentFinish = true;
              if (isLegacyGeminiMalformedCall) {
                suppressDone = true;
              }
              continue;
            }

            if (unifiedChunk.finish_reason) {
              hasSentFinish = true;
            }

            const choice: any = {
              index: 0,
              delta: unifiedChunk.delta,
              finish_reason: unifiedChunk.finish_reason,
            };

            const chunk: any = {
              id: unifiedChunk.id,
              object: 'chat.completion.chunk',
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
                prompt_tokens_details: unifiedChunk.usage.cached_tokens
                  ? { cached_tokens: unifiedChunk.usage.cached_tokens }
                  : null,
                reasoning_tokens: unifiedChunk.usage.reasoning_tokens,
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
  /**
   * Extract usage from OpenAI-style event data (already parsed JSON string)
   */
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
      // Ignore parse errors
    }

    return undefined;
  }
}
