import { createParser } from 'eventsource-parser';

/** Intercept complete client SSE frames without changing unrelated fields or events. */
export function interceptResponseEvents(
  onResponse: (response: unknown, event?: string) => Promise<void>
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';

  async function emitFrames(
    controller: TransformStreamDefaultController<Uint8Array>,
    final: boolean
  ) {
    for (;;) {
      const boundary = /(?:\r\n|\n|\r(?!\n))(?:\r\n|\n|\r(?!\n))/.exec(pending);
      if (!boundary) break;
      const end = boundary.index + boundary[0].length;
      // A trailing CR may be the first half of a CRLF split across chunks.
      if (!final && end === pending.length && pending.endsWith('\r')) break;
      const frame = pending.slice(0, end);
      pending = pending.slice(end);
      let data: string | undefined;
      const parser = createParser({
        onEvent: (event) => {
          data = event.data;
        },
      });
      parser.feed(frame);
      let payload: unknown;
      try {
        if (data !== undefined) payload = JSON.parse(data);
      } catch {
        // Non-JSON SSE data (including [DONE]) passes through unchanged.
      }
      if (
        payload &&
        typeof payload === 'object' &&
        'response' in payload &&
        payload.response &&
        typeof payload.response === 'object'
      ) {
        const event =
          'type' in payload && typeof payload.type === 'string' ? payload.type : undefined;
        await onResponse(payload.response, event);
        let replaced = false;
        const rewritten = frame.replace(
          /(^|\r\n|\r|\n)data(?::[^\r\n]*)?(?=\r|\n|$)/g,
          (line, prefix: string) => {
            if (replaced) return '';
            replaced = true;
            return `${prefix}data: ${JSON.stringify(payload)}`;
          }
        );
        controller.enqueue(encoder.encode(rewritten));
      } else {
        controller.enqueue(encoder.encode(frame));
      }
    }
    if (final && pending) {
      controller.enqueue(encoder.encode(pending));
      pending = '';
    }
  }

  return new TransformStream({
    async transform(chunk, controller) {
      pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      await emitFrames(controller, false);
    },
    async flush(controller) {
      pending += decoder.decode();
      await emitFrames(controller, true);
    },
  });
}
