import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

const fastify = Fastify();
const t0 = Date.now();
const ms = () => `+${Date.now() - t0}ms`;

fastify.post('/test', async (request, reply) => {
  const socket = (request.raw as any)?.socket as any;
  console.log(`${ms()} [request] received`);

  socket?.once('close', () =>
    console.log(`${ms()} [FIRED] socket.close. destroyed=${socket?.destroyed}`)
  );
  request.raw.once('close', () => console.log(`${ms()} [FIRED] request.raw.close`));
  request.raw.once('end', () => console.log(`${ms()} [FIRED] request.raw.end`));

  const webStream = new ReadableStream({
    start(c) {
      let n = 0;
      const iv = setInterval(() => {
        c.enqueue(new TextEncoder().encode(`data:${n++}\n\n`));
        if (n > 200) {
          clearInterval(iv);
          c.close();
        }
      }, 50);
    },
    cancel() {
      console.log(`${ms()} [FIRED] webStream.cancel`);
    },
  });

  const nodeStream = Readable.fromWeb(webStream as any);
  const pipeline = nodeStream.pipe(new PassThrough());
  pipeline.on('error', () => {});
  nodeStream.on('error', () => {});

  reply.header('Content-Type', 'text/event-stream');
  return reply.send(pipeline);
});

fastify.listen({ port: 19993 }, () => console.log(`${ms()} listening`));
