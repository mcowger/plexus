import Fastify from 'fastify';
const fastify = Fastify();
const t0 = Date.now();
const ms = () => `+${Date.now() - t0}ms`;

fastify.post('/test', async (request, reply) => {
  const socket = (request.raw as any)?.socket as any;
  const symHandle = Object.getOwnPropertySymbols(socket).find(
    (s) => s.toString() === 'Symbol(handle)'
  );
  const handle = symHandle ? socket[symHandle] : null;
  console.log(`${ms()} handle type: ${handle?.constructor?.name}`);
  console.log(`${ms()} handle keys: ${Object.getOwnPropertyNames(handle || {}).join(', ')}`);
  console.log(
    `${ms()} handle proto keys: ${Object.getOwnPropertyNames(Object.getPrototypeOf(handle || {})).join(', ')}`
  );

  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let n = 0;
  const iv = setInterval(() => {
    n++;
    reply.raw.write(`data: ${n}\n\n`);
    if (n % 4 === 0) {
      const open = handle?.open;
      const closed = handle?.closed;
      const fd = handle?.fd;
      process.stdout.write(`${ms()} handle.open=${open} handle.closed=${closed} handle.fd=${fd}\r`);
    }
    if (n >= 100) {
      clearInterval(iv);
      reply.raw.end();
    }
  }, 100);
});

fastify.listen({ port: 19987 }, () => console.log(`${ms()} listening`));
