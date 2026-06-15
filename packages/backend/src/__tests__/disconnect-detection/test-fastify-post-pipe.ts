/**
 * Mimics EXACTLY what response-handler.ts does:
 * - POST route (not GET)
 * - Reads + discards the request body first (Fastify does this)
 * - Readable.fromWeb piped through PassThrough, sent via reply.send()
 * - SSE headers
 */
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

const fastify = Fastify();

fastify.post('/v1/chat/completions', async (request, reply) => {
  const socket = (request.raw as any)?.socket as any;
  console.log(`[server] POST request. socket.destroyed=${socket?.destroyed}`);

  // Mimic a fast upstream web stream (like an LLM SSE response)
  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let n = 0;
      const iv = setInterval(() => {
        n++;
        controller.enqueue(new TextEncoder().encode(`data: chunk ${n}\n\n`));
        if (n >= 200) {
          clearInterval(iv);
          controller.close();
        }
      }, 25);
    },
    cancel(reason) {
      console.log(`[FIRED] webStream.cancel reason=${reason}`);
    },
  });

  const nodeStream = Readable.fromWeb(webStream as any);
  const passthrough = new PassThrough(); // stand-in for UsageInspector
  const pipeline = nodeStream.pipe(passthrough);

  let disconnected = false;

  const onDisconnect = (source: string) => {
    if (disconnected) return;
    disconnected = true;
    console.log(`[onDisconnect] source=${source}, socket.destroyed=${socket?.destroyed}`);
    nodeStream.destroy();
    pipeline.destroy();
  };

  socket?.once('close', () => {
    console.log(`[FIRED] socket.close, destroyed=${socket?.destroyed}`);
    onDisconnect('socket.close');
  });
  request.raw.once('close', () => {
    console.log('[FIRED] request.raw.close');
    onDisconnect('request.raw.close');
  });

  pipeline.on('error', (e: any) => console.log(`[FIRED] pipeline.error: ${e.code} ${e.message}`));
  nodeStream.on('error', (e: any) =>
    console.log(`[FIRED] nodeStream.error: ${e.code} ${e.message}`)
  );

  const poll = setInterval(() => {
    process.stdout.write(
      `[poll] socket.destroyed=${socket?.destroyed} nodeStream.destroyed=${nodeStream.destroyed}\r`
    );
    if (disconnected || nodeStream.destroyed) clearInterval(poll);
  }, 250);

  reply.header('Content-Type', 'text/event-stream');
  reply.header('Cache-Control', 'no-cache');
  reply.header('Connection', 'keep-alive');
  return reply.send(pipeline);
});

fastify.listen({ port: 19994 }, () => {
  console.log('Listening on http://localhost:19994');
});
