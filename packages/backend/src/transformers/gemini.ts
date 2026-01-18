/**
 * Re-export wrapper for backward compatibility.
 *
 * The original gemini.ts (591 lines) has been refactored into modular components:
 * - gemini/index.ts: Composition layer
 * - gemini/request-parser.ts: Client → Unified
 * - gemini/request-builder.ts: Unified → Provider
 * - gemini/response-transformer.ts: Provider → Unified
 * - gemini/response-formatter.ts: Unified → Client
 * - gemini/stream-transformer.ts: Provider Stream → Unified
 * - gemini/stream-formatter.ts: Unified → Client Stream
 * - gemini/part-mapper.ts: Part conversion utilities
 *
 * This file maintains backward compatibility by re-exporting the main class and types.
 * All import paths continue to work:
 *   import { GeminiTransformer } from '../transformers/gemini'
 *   import { GeminiTransformer } from '../transformers'
 */

export { GeminiTransformer } from './gemini/index';
export type { GenerateContentRequest } from './gemini/request-builder';
