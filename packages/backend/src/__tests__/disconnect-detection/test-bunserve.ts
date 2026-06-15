/**
 * Tests disconnect detection on Bun.serve() (native Bun HTTP).
 * Run: bun test-bunserve.ts
 */

const server = Bun.serve({
  port: 19998,
  fetch(req) {
    console.log('[server] new request');

    // Test 1: request.signal abort
    req.signal.addEventListener('abort', () => {
      console.log('[FIRED] request.signal abort');
    });

    let count = 0;
    const stream = new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          count++;
          const aborted = req.signal.aborted;
          console.log(`[poll ${count}] req.signal.aborted=${aborted}`);
          try {
            controller.enqueue(new TextEncoder().encode(`data: ping ${count}\n\n`));
          } catch (e: any) {
            console.log(`[poll ${count}] enqueue threw: ${e.message}`);
            clearInterval(interval);
          }
          if (count >= 20) {
            clearInterval(interval);
            controller.close();
            server.stop();
          }
        }, 250);
      },
      cancel(reason) {
        console.log(`[FIRED] ReadableStream cancel, reason: ${reason}`);
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  },
});

console.log('Listening on http://localhost:19998');
console.log('Run: curl -N http://localhost:19998 & sleep 2 && kill %1');
