/**
 * TransformerFactory resolution for the wire protocols the response handler
 * asks it for (`plexus.apiType`).
 *
 * `images` is the ONE non-wire entry: the auto-bridge
 * (services/dispatch/image-model-bridge.ts) hands the response handler output
 * that is ALREADY unified, so the factory must return a transformer with no
 * `transformStream` — that is what lets the synthesized unified chunk stream
 * flow straight into the client formatter. A dedicated image TARGET protocol
 * such as `codex-images` is never a chat wire protocol and must still throw
 * (it belongs to ImageGenerationTransformerFactory).
 */

import { describe, expect, it, test } from 'bun:test';

import { ImageBridgeTransformer } from '../../../transformers/image-bridge';
import { TransformerFactory } from '../transformer-factory';

describe('TransformerFactory', () => {
  test('resolves the no-op images transformer for bridged image output', () => {
    const transformer = TransformerFactory.getTransformer('images');

    expect(transformer).toBeInstanceOf(ImageBridgeTransformer);
    // No transformStream: the bridged stream is already unified chunks.
    expect(transformer.transformStream).toBeUndefined();
  });

  test('still resolves the ordinary wire protocols', () => {
    expect(TransformerFactory.getTransformer('chat').name).toBe('chat');
    expect(TransformerFactory.getTransformer('messages').name).toBe('messages');
    expect(TransformerFactory.getTransformer('gemini').name).toBe('gemini');
    expect(TransformerFactory.getTransformer('responses').name).toBe('responses');
  });

  test('still rejects image TARGET protocols, which are not chat wire protocols', () => {
    expect(() => TransformerFactory.getTransformer('codex-images')).toThrow(
      'Unsupported provider type'
    );
    expect(() => TransformerFactory.getTransformer('openai-images')).toThrow(
      'Unsupported provider type'
    );
  });
});
