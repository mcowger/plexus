/**
 * Inspector Stream Factory
 *
 * Creates 'taps' for our data pipeline using Node.js PassThrough streams.
 * A PassThrough stream is a simple implementation of a Transform stream that
 * passes all input data to the output unmodified.
 *
 * Crucially, they allow us to 'observe' the data as it flows through the pipeline
 * without modifying it or affecting backpressure significantly.
 */

export { DebugLoggingInspector } from './debug-logging';
export { UsageInspector } from './usage-logging';
