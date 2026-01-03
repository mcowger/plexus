Since Web Workers in many runtimes have difficulty with class instantiation (and serializing complex class instances across the thread boundary is a headache), we will move to a **Decoupled Main-Thread Task Queue**.

This design uses Bun's microtask queue and the event loop to ensure your metadata logic is always executed **after** the stream chunk has been forwarded to the client.

---

# Design Doc: Non-Blocking Stream Observation (Event-Loop Decoupling)

## 1. Objective

Observe a `ReadableStream` on the main thread without blocking the stream’s flow or risking stability. This version avoids Web Workers and instead uses an **Asynchronous Sidecar Queue** to handle metadata processing.

### Constraints

* **No Web Workers:** Logic remains on the main thread for easy access to classes and shared state.
* **Main-Thread Prioritization:** The stream must enqueue the next chunk to the consumer before the observer logic begins.
* **Memory Safety:** Use a capped queue to prevent OOM during traffic spikes.

---

## 2. Architectural Overview

We utilize a `TransformStream` as a pass-through. Inside the `transform` method, we push a copy of the data into a specialized `TaskQueue` class. This class processes items using `setImmediate` or `process.nextTick` (via `Bun.sleep(0)`), ensuring the stream-pumping logic always takes priority over the observation logic.

---

## 3. Implementation Specification

### A. The Observer Sidecar (The Class-Friendly Processor)

This class manages the "heavy" work. Because it's on the main thread, you can instantiate any DB clients, logger classes, or metadata trackers here directly.

```typescript
// observer-sidecar.ts
export class StreamObserver {
  private queue: any[] = [];
  private isProcessing = false;
  private MAX_QUEUE_SIZE = 1000;

  constructor(private processor: (data: any) => Promise<void>) {}

  public push(data: any) {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn("Observer queue saturated. Dropping metadata packet.");
      return;
    }
    this.queue.push(data);
    this.process();
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      try {
        // Bun.sleep(0) yields to the event loop so the 
        // ReadableStream can pump the next chunk if it's ready.
        await Bun.sleep(0); 
        await this.processor(item);
      } catch (err) {
        console.error("Observer processing error:", err);
      }
    }

    this.isProcessing = false;
  }
}

```

### B. The Main Thread Tap

This function wraps the stream. It clones chunks (if binary) to ensure that if the observer modifies a property, it doesn't affect the data being sent to the client.

```typescript
// stream-tap.ts
import { StreamObserver } from "./observer-sidecar";

export function tapStream<T>(
  source: ReadableStream<T>, 
  observerInstance: StreamObserver
): ReadableStream<T> {
  
  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      // 1. Forward to client IMMEDIATELY
      controller.enqueue(chunk);

      // 2. Clone for the observer to prevent cross-contamination
      const observationData = (chunk instanceof Uint8Array) 
        ? new Uint8Array(chunk) 
        : JSON.parse(JSON.stringify(chunk)); // Simple clone for objects

      // 3. Fire-and-forget push to sidecar
      observerInstance.push(observationData);
    }
  }));
}

```

---

## 4. Reasoning & Justification

* **Yielding to I/O:** By using `await Bun.sleep(0)` inside the observer's loop, we ensure that if a new chunk arrives from the producer, Bun's scheduler can handle the `TransformStream`'s `enqueue` before returning to finish the observer's metadata task.
* **Class Accessibility:** Since this lives on the main thread, you don't have to worry about "Structured Clone" limitations. You can pass class instances, functions, or complex objects to the `StreamObserver` constructor.
* **Error Isolation:** The `StreamObserver` wraps the `processor` call in its own `try/catch`. Since the `TransformStream` does not `await` the `push()` call, a crash in the observer cannot propagate back to the stream controller.
* **Spike Handling:** The `MAX_QUEUE_SIZE` acts as a circuit breaker. If the metadata processing falls too far behind the  stream, it drops packets to ensure the server's memory remains stable.

---

## 5. Summary Table

| Feature | Design Detail |
| --- | --- |
| **Concurrency** | Co-operative multitasking via Event Loop yielding. |
| **Data Safety** | Defensive cloning before observation. |
| **Priority** | Consumer > Producer > Observer. |
| **Complexity** | Low (Single thread, no serialization). |