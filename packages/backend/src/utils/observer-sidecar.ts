/**
 * StreamObserver - A Class-Friendly Processor for Non-Blocking Stream Observation
 * 
 * This class manages "heavy" metadata processing work on the main thread
 * without blocking the stream flow. It uses an asynchronous task queue
 * that yields to the event loop via Bun.sleep(0), ensuring stream chunks
 * are always prioritized over observation logic.
 * 
 * Key features:
 * - No Web Workers needed - stays on main thread for easy class access
 * - Event loop yielding ensures stream pumping takes priority
 * - Capped queue prevents OOM during traffic spikes
 * - Error isolation prevents observer crashes from affecting streams
 */

export class StreamObserver<T = any> {
  private queue: T[] = [];
  private isProcessing = false;
  private readonly MAX_QUEUE_SIZE: number;
  private processor: (data: T) => Promise<void>;

  constructor(
    processor: (data: T) => Promise<void>,
    maxQueueSize: number = 1000
  ) {
    this.processor = processor;
    this.MAX_QUEUE_SIZE = maxQueueSize;
  }

  /**
   * Push data into the observation queue.
   * This is a fire-and-forget operation that doesn't block.
   */
  public push(data: T): void {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`Observer queue saturated (${this.MAX_QUEUE_SIZE} items). Dropping metadata packet.`);
      return;
    }
    this.queue.push(data);
    this.process();
  }

  /**
   * Process queued items asynchronously.
   * Yields to the event loop between each item to ensure
   * the ReadableStream can pump the next chunk if ready.
   */
  private async process(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      try {
        // Bun.sleep(0) yields to the event loop so the 
        // ReadableStream can pump the next chunk if it's ready.
        // This ensures the observer never blocks the stream flow.
        await Bun.sleep(0);
        await this.processor(item);
      } catch (err) {
        console.error("Observer processing error:", err);
        // Continue processing remaining items even if one fails
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get the current queue size (for monitoring/debugging)
   */
  public get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Check if the observer is currently processing
   */
  public get isActive(): boolean {
    return this.isProcessing;
  }
}

