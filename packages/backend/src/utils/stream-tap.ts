/**
 * Stream Tap - Non-Blocking Stream Observation
 * 
 * This module provides utilities for observing ReadableStream chunks
 * without blocking the stream's flow. It uses the StreamObserver class
 * to handle metadata processing asynchronously on the main thread.
 * 
 * Key features:
 * - Forwards chunks to client IMMEDIATELY (no blocking)
 * - Clones data for observer to prevent cross-contamination
 * - Fire-and-forget observation (errors don't propagate to stream)
 * - Priority: Consumer > Producer > Observer
 */

import { StreamObserver } from "./observer-sidecar";

/**
 * Tap into a ReadableStream to observe chunks without blocking flow.
 * 
 * @param source - The original ReadableStream to observe
 * @param observerInstance - StreamObserver instance to handle observation
 * @returns A new ReadableStream that forwards all chunks and observes them
 */
export function tapStream<T>(
  source: ReadableStream<T>,
  observerInstance: StreamObserver<T>
): ReadableStream<T> {
  let chunkCount = 0;
  
  return source.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        chunkCount++;
        
        // 1. Forward to client IMMEDIATELY
        // This ensures the consumer gets data as fast as possible
        controller.enqueue(chunk);

        // 2. Clone for the observer to prevent cross-contamination
        // Defensive cloning ensures that if the observer modifies data,
        // it doesn't affect what was sent to the client
        let observationData: T;
        if (chunk instanceof Uint8Array) {
          // Binary data - create a new array with copied contents
          observationData = new Uint8Array(chunk) as T;
        } else if (typeof chunk === 'object' && chunk !== null) {
          // Object data - deep clone via JSON (simple and effective)
          try {
            observationData = JSON.parse(JSON.stringify(chunk));
          } catch (e) {
            // If JSON cloning fails, pass the original
            // (observer should be read-only anyway)
            observationData = chunk;
          }
        } else {
          // Primitive data - safe to pass directly
          observationData = chunk;
        }

        // 3. Fire-and-forget push to sidecar
        // This is non-blocking - observer processes asynchronously
        observerInstance.push(observationData);
        console.debug(`[TapStream] Chunk ${chunkCount} forwarded and queued for observation`);
      },
      flush() {
        console.debug(`[TapStream] Stream flush() called after ${chunkCount} chunks`);
      }
    })
  );
}

/**
 * Observes a stream by creating two independent copies without using .tee().
 * One branch goes to the client, the other can be observed/processed separately.
 * This is useful when you need to send raw data to the client
 * while also observing a transformed version for metadata.
 * 
 * @param source - The original ReadableStream
 * @returns Object with clientStream (raw) and usageStream (for observation)
 */
export function observeStream<T>(
  source: ReadableStream<T>
): { clientStream: ReadableStream<T>; usageStream: ReadableStream<T> } {
  let usageController: ReadableStreamDefaultController<T>;

  // Create the usage stream that the observer will watch
  const usageStream = new ReadableStream<T>({
    start(controller) {
      usageController = controller;
    },
  });

  // Tap the source to split it
  const clientStream = source.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        try {
          // 1. Forward to client IMMEDIATELY
          controller.enqueue(chunk);

          // 2. Clone to usage stream
          let clonedChunk: T;
          if (chunk instanceof Uint8Array) {
            clonedChunk = new Uint8Array(chunk) as T;
          } else if (typeof chunk === 'object' && chunk !== null) {
            try {
              clonedChunk = JSON.parse(JSON.stringify(chunk));
            } catch (e) {
              clonedChunk = chunk;
            }
          } else {
            clonedChunk = chunk;
          }

          // 3. Enqueue to usage stream (which observer can watch)
          usageController.enqueue(clonedChunk);
        } catch (e) {
          // Error handling - close usage stream and propagate to client
          usageController.error(e);
          controller.error(e);
        }
      },
      flush() {
        // Close usage stream when source completes
        usageController.close();
      },
    })
  );

  return { clientStream, usageStream };
}
