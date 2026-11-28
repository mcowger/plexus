import { createParser } from 'eventsource-parser';

import { logger } from '../../utils/logger';
import { isProviderFaultStreamFailure } from '../../utils/stream-failure';
import type { StallConfig } from '../inspectors/stall-inspector';

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

const LIFECYCLE_PRELUDE_EVENT_TYPES: Record<string, true> = {
  'response.created': true,
  'response.in_progress': true,
  'response.queued': true,
  // ChatGPT/Codex backend: moderation metadata sent before any output; nothing visible.
  'response.metadata': true,
};

/**
 * Decodes buffered SSE bytes with every line ending (LF, CRLF, CR) normalized to LF, so a
 * blank line is always `\n\n`. A trailing bare CR is dropped: it may be half of a CRLF whose
 * LF has not arrived yet, and counting it as a line ending would invent a frame boundary.
 */
function decodeSse(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\r$/, '').replace(/\r\n?/g, '\n');
}

/**
 * True when the buffered bytes hold at least one complete Responses lifecycle frame
 * (`response.created` etc.) and no other complete event, so no output has been shown and a
 * later `response.failed` can still fail over. The SSE parser ignores comments (`: ping`)
 * and unfinished frames. Any other first event (Chat/Anthropic SSE, NDJSON, plain JSON) is
 * never held.
 */
export function isLifecyclePreludeOnly(chunks: Uint8Array[]): boolean {
  let sawLifecycle = false;
  let onlyLifecycle = true;
  const parser = createParser({
    onEvent: (event) => {
      let type: unknown;
      try {
        type = JSON.parse(event.data)?.type;
      } catch {
        type = undefined;
      }
      if (typeof type === 'string' && LIFECYCLE_PRELUDE_EVENT_TYPES[type] === true) {
        sawLifecycle = true;
      } else {
        onlyLifecycle = false;
      }
    },
  });
  parser.feed(new TextDecoder().decode(concatChunks(chunks)));
  return sawLifecycle && onlyLifecycle;
}

/**
 * Inspects the initial raw stream bytes for early SSE/JSON error events
 * (such as OpenRouter/OpenAI 429 rate limit or server errors sent with HTTP 200).
 * Supports single chunks or arrays of chunks that may contain multi-read SSE frames.
 */
export function parseInitialStreamError(input: Uint8Array | Uint8Array[]): Error | null {
  const bytes = Array.isArray(input) ? concatChunks(input) : input;
  if (!bytes || bytes.length === 0) return null;
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return null;

  // 1. Try parsing SSE frames (each keeps its own event type) or raw JSON
  const sseText = decodeSse(bytes).trim();
  const candidates: { json: string; eventType: string }[] = [];
  for (const frame of sseText.split('\n\n')) {
    let frameEventType = '';
    const frameData: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('event:')) {
        frameEventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        frameData.push(line.slice(5).trim());
      }
    }
    for (const json of frameData) {
      candidates.push({ json, eventType: frameEventType });
    }
    if (frameData.length > 1) {
      candidates.push({ json: frameData.join('\n'), eventType: frameEventType });
    }
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    candidates.push({ json: text, eventType: '' });
  }

  for (const { json: candidateJson, eventType } of candidates) {
    if (!candidateJson || candidateJson === '[DONE]') continue;

    try {
      const parsed = JSON.parse(candidateJson);
      if (!parsed || typeof parsed !== 'object') continue;

      // Normal completion chunks with choices or content blocks are not error payloads
      const isNormalChoiceChunk =
        Array.isArray(parsed.choices) &&
        parsed.choices.length > 0 &&
        parsed.choices[0]?.delta !== undefined;
      const isNormalAnthropicChunk =
        parsed.type === 'message_start' ||
        parsed.type === 'content_block_start' ||
        parsed.type === 'content_block_delta' ||
        parsed.type === 'message_delta' ||
        parsed.type === 'message_stop';
      if (isNormalChoiceChunk || isNormalAnthropicChunk) {
        continue;
      }

      // Caller-fault response.failed (e.g. image_too_large) must pass through: failing over
      // or cooling down the target for it would sideline it for valid traffic.
      if (
        parsed.type === 'response.failed' &&
        !isProviderFaultStreamFailure(parsed.response ?? null)
      ) {
        continue;
      }
      const hasErrorProp = parsed.error !== undefined && parsed.error !== null;
      const isErrorEvent =
        eventType === 'error' ||
        parsed.type === 'error' ||
        parsed.event === 'error' ||
        parsed.type === 'response.failed';
      const isErrorStatus =
        (typeof parsed.code === 'number' && parsed.code >= 400) ||
        (typeof parsed.status === 'number' && parsed.status >= 400);
      const isProviderReturnedError =
        parsed.message === 'Provider returned error' ||
        parsed.error?.message === 'Provider returned error';

      if (!hasErrorProp && !isErrorEvent && !isErrorStatus && !isProviderReturnedError) {
        continue;
      }

      const nestedError =
        typeof parsed.response?.error === 'object' && parsed.response.error !== null
          ? parsed.response.error
          : null;
      const errorObj =
        typeof parsed.error === 'object' && parsed.error !== null
          ? parsed.error
          : (nestedError ?? parsed);
      const meta = errorObj.metadata || parsed.metadata;
      const rawMsg = meta?.raw;
      const message =
        (typeof rawMsg === 'string' && rawMsg.trim()) ||
        errorObj.message ||
        parsed.message ||
        (typeof parsed.error === 'string' ? parsed.error : 'Stream error from upstream provider');

      let statusCode = 502;
      if (typeof errorObj.code === 'number') {
        statusCode = errorObj.code;
      } else if (typeof parsed.code === 'number') {
        statusCode = parsed.code;
      } else if (typeof errorObj.status === 'number') {
        statusCode = errorObj.status;
      } else if (typeof errorObj.code === 'string' && !isNaN(Number(errorObj.code))) {
        statusCode = Number(errorObj.code);
      } else if (
        String(message).toLowerCase().includes('rate-limited') ||
        String(message).toLowerCase().includes('rate limit') ||
        errorObj.type === 'rate_limit_error'
      ) {
        statusCode = 429;
      }

      let cooldownDuration: number | undefined;
      const retrySec = meta?.retry_after_seconds ?? meta?.retry_after_seconds_raw;
      if (retrySec !== undefined && retrySec !== null) {
        const sec = typeof retrySec === 'number' ? retrySec : parseFloat(String(retrySec));
        if (Number.isFinite(sec) && sec > 0) {
          cooldownDuration = Math.ceil(sec * 1000);
        }
      }
      if (!cooldownDuration) {
        // OpenRouter nests headers under `error.metadata`; the ChatGPT/Codex backend puts
        // them directly on `error` (`error.headers['retry-after']`).
        const headers = meta?.headers ?? errorObj.headers;
        const headerRetry = headers?.['Retry-After'] || headers?.['retry-after'];
        if (headerRetry) {
          const sec = parseFloat(headerRetry);
          if (Number.isFinite(sec) && sec > 0) {
            cooldownDuration = Math.ceil(sec * 1000);
          }
        }
      }

      const err = new Error(String(message));
      (err as any).isStreamError = true;
      (err as any).statusCode = statusCode;
      (err as any).routingContext = {
        statusCode,
        providerResponse: text,
        cooldownTriggered: true,
      };
      if (cooldownDuration) {
        (err as any).cooldownDuration = cooldownDuration;
      }

      return err;
    } catch {
      // incomplete or invalid JSON chunk, continue checking
    }
  }

  return null;
}

export async function probeStreamingStart(
  response: Response,
  stallConfig?: StallConfig | null
): Promise<{ ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }> {
  if (!response.body) {
    return { ok: true, response };
  }

  // When TTFB stall detection is configured, probe the stream until we've
  // received ttfbBytes or the TTFB timeout fires. This allows the
  // failover loop to retry with a different provider when a provider is
  // slow to start responding.
  if (stallConfig?.ttfbMs != null) {
    logger.debug(
      `probeStreamingStart: using stall-aware probe (ttfbMs=${stallConfig.ttfbMs}, ttfbBytes=${stallConfig.ttfbBytes})`
    );
    return probeStreamingStartWithStallCheck(response, stallConfig);
  }

  // Original 100ms probe — if the first byte doesn't arrive within 100ms,
  // let the stream continue in the background.
  const reader = response.body.getReader();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ timeout: true }), 100);
  });

  try {
    const readPromise = reader.read();
    const readResult = await Promise.race([readPromise, timeoutPromise]);

    if ((readResult as any).timeout) {
      const passthrough = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const first = await readPromise;
            if (!first.done && first.value) {
              controller.enqueue(first.value);
            } else if (first.done) {
              controller.close();
            }
          } catch (error) {
            controller.error(error);
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });

      return {
        ok: true,
        response: new Response(passthrough, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
      };
    }

    const first = readResult as ReadableStreamReadResult<Uint8Array>;
    const buffered: Uint8Array[] = [];
    if (!first.done && first.value) {
      buffered.push(first.value);
      // Hold back lifecycle-only prelude frames (response.created etc.): nothing visible
      // has been committed to the client, so a later response.failed can still fail over.
      while (true) {
        const initialError = parseInitialStreamError(buffered);
        if (initialError) {
          reader.cancel().catch(() => {});
          logger.warn(`probeStreamingStart: detected early stream error: ${initialError.message}`);
          return {
            ok: false,
            error: initialError,
            streamStarted: false,
          };
        }
        if (!isLifecyclePreludeOnly(buffered)) break;
        const next = await reader.read();
        if (next.done) break;
        buffered.push(next.value);
      }
    }

    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of buffered) {
          controller.enqueue(chunk);
        }
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return {
      ok: true,
      response: new Response(replay, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      streamStarted: false,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Stall-aware stream probe: reads from the stream until we've received
 * `stallConfig.ttfbBytes` bytes or the TTFB timeout fires.
 *
 * - If TTFB threshold is met → returns ok:true, stream continues normally.
 * - If TTFB timeout fires → returns ok:false with a stall error, which the
 *   failover loop treats as retryable (same as a network error before first byte).
 */
async function probeStreamingStartWithStallCheck(
  response: Response,
  stallConfig: StallConfig
): Promise<{ ok: true; response: Response } | { ok: false; error: Error; streamStarted: boolean }> {
  const reader = response.body!.getReader();
  const ttfbBytes = stallConfig.ttfbBytes;
  const ttfbMs = stallConfig.ttfbMs!;

  // Collected chunks to replay into the response stream
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let streamStarted = false;

  // TTFB stall timer
  let ttfbTimerId: ReturnType<typeof setTimeout> | undefined;
  const ttfbTimeoutPromise = new Promise<'ttfb_timeout'>((resolve) => {
    ttfbTimerId = setTimeout(() => resolve('ttfb_timeout'), ttfbMs);
  });

  try {
    // Read chunks until we hit the TTFB byte threshold or the timeout
    // Keep reading past lifecycle-only prelude frames (bounded by the same TTFB timer) so a
    // later response.failed can still fail over, mirroring the non-stall probe.
    while (totalBytes < ttfbBytes || isLifecyclePreludeOnly(chunks)) {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, ttfbTimeoutPromise]);

      if (result === 'ttfb_timeout') {
        // TTFB stall detected — abort the reader
        reader
          .cancel(new DOMException('Stream stalled: TTFB timeout', 'TimeoutError'))
          .catch(() => {});
        logger.info(
          `TTFB stall probe: received ${totalBytes} bytes within ${ttfbMs}ms ` +
            `(threshold: ${ttfbBytes} bytes)`
        );
        return {
          ok: false,
          error: new Error(
            `Stream stalled: TTFB timeout — received ${totalBytes} bytes in ${ttfbMs}ms ` +
              `(threshold: ${ttfbBytes} bytes within ${ttfbMs}ms)`
          ),
          streamStarted,
        };
      }

      const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        // Stream ended before we got enough bytes — not a stall, just a short response
        break;
      }

      chunks.push(value);
      totalBytes += value.length;
      // A lifecycle-only prelude has committed nothing visible, so it must stay retryable.
      streamStarted = !isLifecyclePreludeOnly(chunks);
    }

    if (chunks.length > 0) {
      const initialError = parseInitialStreamError(chunks);
      if (initialError) {
        reader.cancel().catch(() => {});
        logger.warn(`probeStreamingStart: detected early stream error: ${initialError.message}`);
        return {
          ok: false,
          error: initialError,
          streamStarted: false,
        };
      }
    }

    // TTFB threshold met (or stream ended naturally) — build replay stream
    const replayChunks = [...chunks];
    let chunkIndex = 0;
    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        // Replay buffered chunks
        while (chunkIndex < replayChunks.length) {
          controller.enqueue(replayChunks[chunkIndex]!);
          chunkIndex++;
        }
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
          } else {
            controller.enqueue(next.value);
          }
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return {
      ok: true,
      response: new Response(replay, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      streamStarted,
    };
  } finally {
    if (ttfbTimerId) clearTimeout(ttfbTimerId);
  }
}
