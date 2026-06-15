/**
 * Tests the full cancellation chain options.
 *
 * Option A: pipeline.destroy() — does it cancel the web stream?
 * Option B: abortController.abort() on the upstream fetch signal — does it cancel the stream?
 * Option C: manually calling reader.cancel() on the web stream's reader?
 */
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

function makeUpstreamStream(label: string) {
  let cancelFired = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let n = 0;
      const iv = setInterval(() => {
        n++;
        if (n <= 10) process.stdout.write(`  [${label} upstream] chunk ${n}\n`);
        controller.enqueue(new TextEncoder().encode(`chunk ${n}\n`));
        if (n >= 30) {
          clearInterval(iv);
          controller.close();
        }
      }, 100);
    },
    cancel(reason) {
      cancelFired = true;
      console.log(`  [${label} FIRED] web stream cancel, reason: ${reason}`);
    },
  });
  return { stream, isCancelled: () => cancelFired };
}

// --- Test A: destroy the passthrough (end of pipeline) ---
async function testA() {
  console.log('\n=== Test A: pipeline.destroy() ===');
  const { stream, isCancelled } = makeUpstreamStream('A');
  const node = Readable.fromWeb(stream as any);
  const pt = new PassThrough();
  const pipeline = node.pipe(pt);
  pipeline.on('error', () => {}); // suppress unhandled error
  pipeline.on('data', () => {});
  await Bun.sleep(300);
  console.log('  Destroying pipeline...');
  pipeline.destroy();
  await Bun.sleep(500);
  console.log(`  cancelFired=${isCancelled()} (expected: true)`);
}

// --- Test B: destroy the source nodeStream ---
async function testB() {
  console.log('\n=== Test B: nodeStream.destroy() (source) ===');
  const { stream, isCancelled } = makeUpstreamStream('B');
  const node = Readable.fromWeb(stream as any);
  const pt = new PassThrough();
  node.pipe(pt);
  pt.on('error', () => {});
  pt.on('data', () => {});
  await Bun.sleep(300);
  console.log('  Destroying nodeStream...');
  node.destroy();
  await Bun.sleep(500);
  console.log(`  cancelFired=${isCancelled()} (expected: true)`);
}

// --- Test C: abort via AbortController on a real fetch stream ---
async function testC() {
  console.log('\n=== Test C: abortController.abort() cancels fetch stream ===');
  // We use a local echo server to test fetch cancellation
  const ac = new AbortController();
  const server = Bun.serve({
    port: 19995,
    fetch() {
      let n = 0;
      const s = new ReadableStream({
        start(c) {
          const iv = setInterval(() => {
            c.enqueue(new TextEncoder().encode(`x`));
            if (++n > 100) {
              clearInterval(iv);
              c.close();
            }
          }, 50);
        },
      });
      return new Response(s);
    },
  });

  let fetchCancelled = false;
  let streamCancelled = false;

  try {
    const resp = await fetch('http://localhost:19995', { signal: ac.signal });
    const node = Readable.fromWeb(resp.body as any);
    const pt = new PassThrough();
    node.pipe(pt);
    pt.on('error', () => {});
    pt.on('data', () => {});
    node.on('error', () => {});

    await Bun.sleep(200);
    console.log('  Aborting fetch via AbortController...');
    ac.abort();
    await Bun.sleep(500);
    console.log(`  nodeStream.destroyed=${node.destroyed}`);
  } catch (e: any) {
    fetchCancelled = true;
    console.log(`  fetch threw: ${e.name} ${e.message}`);
  }

  server.stop(true);
}

await testA();
await testB();
await testC();
console.log('\nDone.');
process.exit(0);
