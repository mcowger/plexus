/**
 * Test: if we add an abort event listener to the signal AFTER streaming starts,
 * can we use that to trigger nodeStream.destroy() and cancel the upstream?
 *
 * This would be the pattern for wiring up timeout support properly:
 *   signal.addEventListener('abort', () => { nodeStream.destroy(); pipeline.destroy(); })
 */
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

let chunkCount = 0;
let cancelFired = false;
let listenerFired = false;

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

// Wire the abort signal to destroy both streams — this is the pattern
// that should be used in response-handler.ts for timeout support
ac.signal.addEventListener('abort', () => {
  listenerFired = true;
  console.log(`\n[FIRED] abort listener, reason.name=${ac.signal.reason?.name}`);
  nodeStream.destroy();
  pipeline.destroy();
});

// Timeout fires mid-stream
setTimeout(() => {
  console.log(`\n--- ac.abort(TimeoutError) at chunk ~${chunkCount} ---`);
  ac.abort(new DOMException('signal timed out', 'TimeoutError'));
}, 400);

setTimeout(() => {
  console.log(`listenerFired=${listenerFired}       (expected true)`);
  console.log(`cancelFired=${cancelFired}           (expected true)`);
  console.log(`nodeStream.destroyed=${nodeStream.destroyed} (expected true)`);
  console.log(`chunkCount=${chunkCount}             (stopped growing = upstream cancelled)`);
  process.exit(0);
}, 1800);
