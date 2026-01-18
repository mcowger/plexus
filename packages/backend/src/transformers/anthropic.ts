/**
 * Re-export wrapper for backward compatibility.
 *
 * The original anthropic.ts (889 lines) has been refactored into modular components:
 * - anthropic/index.ts: Composition layer
 * - anthropic/request-parser.ts: Client → Unified
 * - anthropic/request-builder.ts: Unified → Provider
 * - anthropic/response-transformer.ts: Provider → Unified
 * - anthropic/response-formatter.ts: Unified → Client
 * - anthropic/stream-transformer.ts: Provider Stream → Unified
 * - anthropic/stream-formatter.ts: Unified → Client Stream
 * - anthropic/content-mapper.ts: Content utilities
 * - anthropic/tool-mapper.ts: Tool conversion utilities
 *
 * This file maintains backward compatibility by re-exporting the main class.
 * All import paths continue to work:
 *   import { AnthropicTransformer } from '../transformers/anthropic'
 *   import { AnthropicTransformer } from '../transformers'
 */

export { AnthropicTransformer } from './anthropic/index';
