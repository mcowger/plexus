/**
 * Test: does nodeStream.destroy() + abortController.abort() together stop
 * the upstream, even if abort() alone doesn't?
 *
 * This is what our onDisconnect() does — confirms the same fix works for timeouts.
 */
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

let chunkCount = 0;
let cancelFired = false;

const ac = new AbortController();

const webStream = new ReadableStream<Uint8Array>({
  start(controller) {
    const iv = setInterval(() => {
      chunkCount++;
      try {
        controller.enqueue(new TextEncoder().encode(`chunk ${chunkCount}\n`));
      } catch {
        clearInterval(iv);
      }
      if (chunkCount >= 50) {
        clearInterval(iv);
        controller.close();
      }
    }, 50);
  },
  cancel(reason) {
    cancelFired = true;
    console.log(`\n[FIRED] webStream.cancel, reason: ${reason}`);
  },
});

const nodeStream = Readable.fromWeb(webStream as any);
const pipeline = nodeStream.pipe(new PassThrough());
pipeline.on('data', () => {});
pipeline.on('error', () => {});
nodeStream.on('error', () => {});

// Same fix as onDisconnect() — both abort AND destroy the source nodeStream
setTimeout(() => {
  console.log(`\n--- timeout: abort() + nodeStream.destroy() at chunk ~${chunkCount} ---`);
  ac.abort(new DOMException('signal timed out', 'TimeoutError'));
  nodeStream.destroy();
  pipeline.destroy();
}, 400);

setTimeout(() => {
  console.log(`cancelFired=${cancelFired}          (expected true)`);
  console.log(`nodeStream.destroyed=${nodeStream.destroyed} (expected true)`);
  console.log(`chunkCount=${chunkCount}            (stopped growing = upstream cancelled)`);
  process.exit(0);
}, 1800);
