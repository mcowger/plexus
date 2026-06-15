/**
 * Test: does writing to a disconnected client's response cause an error we can catch?
 */
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

const fastify = Fastify();
const t0 = Date.now();
const ms = () => `+${Date.now() - t0}ms`;

fastify.post('/test', async (request, reply) => {
  console.log(`${ms()} [request] received`);

  const webStream = new ReadableStream({
    start(c) {
      let n = 0;
      const iv = setInterval(() => {
        n++;
        process.stdout.write(`${ms()} [upstream] producing chunk ${n}\r`);
        c.enqueue(new TextEncoder().encode(`data: chunk ${n}\n\n`));
        if (n > 200) {
          clearInterval(iv);
          c.close();
        }
      }, 50);
    },
    cancel() {
      console.log(`\n${ms()} [FIRED] webStream.cancel`);
    },
  });

  const nodeStream = Readable.fromWeb(webStream as any);
  const passthrough = new PassThrough();
  const pipeline = nodeStream.pipe(passthrough);

  pipeline.on('error', (e: any) =>
    console.log(`\n${ms()} [FIRED] pipeline.error: code=${e.code} msg=${e.message}`)
  );
  nodeStream.on('error', (e: any) =>
    console.log(`\n${ms()} [FIRED] nodeStream.error: code=${e.code} msg=${e.message}`)
  );
  passthrough.on('error', (e: any) =>
    console.log(`\n${ms()} [FIRED] passthrough.error: code=${e.code} msg=${e.message}`)
  );

  reply.header('Content-Type', 'text/event-stream');
  return reply.send(pipeline);
});

fastify.listen({ port: 19992 }, () => console.log(`${ms()} listening`));
