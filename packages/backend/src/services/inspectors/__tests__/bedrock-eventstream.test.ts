import { EventStreamCodec } from '@smithy/core/event-streams';
import { describe, expect, test } from 'vitest';

import { BedrockEventStreamMetadataObserver } from '../bedrock-eventstream';

// Smithy's Encoder turns bytes into a string; Decoder turns a string into bytes.
const codec = new EventStreamCodec(
  (input: Uint8Array) => new TextDecoder().decode(input),
  (input: string) => new TextEncoder().encode(input)
);

function frame(eventType: string, payload: Record<string, unknown>): Buffer {
  return Buffer.from(
    codec.encode({
      headers: {
        ':message-type': { type: 'string', value: 'event' },
        ':event-type': { type: 'string', value: eventType },
        ':content-type': { type: 'string', value: 'application/json' },
      },
      body: new TextEncoder().encode(JSON.stringify(payload)),
    })
  );
}

function metadataFrame(payload: Record<string, unknown>): Buffer {
  return frame('metadata', payload);
}

describe('BedrockEventStreamMetadataObserver', () => {
  test('captures the metadata serviceTier payload', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    observer.feed(metadataFrame({ usage: { inputTokens: 7 }, serviceTier: { type: 'priority' } }));

    expect(observer.getReconstructed()).toEqual({
      usage: { inputTokens: 7 },
      serviceTier: { type: 'priority' },
    });
  });

  test('reassembles a frame split across arbitrary chunk boundaries', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    const bytes = metadataFrame({ serviceTier: { type: 'flex' } });

    for (let offset = 0; offset < bytes.length; offset += 3) {
      observer.feed(bytes.subarray(offset, Math.min(offset + 3, bytes.length)));
    }

    expect(observer.getReconstructed()).toEqual({ serviceTier: { type: 'flex' } });
  });

  test('handles a single-byte-at-a-time feed', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    const bytes = metadataFrame({ serviceTier: { type: 'default' } });

    for (const byte of bytes) observer.feed(Buffer.from([byte]));

    expect(observer.getReconstructed()).toEqual({ serviceTier: { type: 'default' } });
  });

  test('ignores non-metadata events', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    observer.feed(frame('contentBlockDelta', { delta: { text: 'hi' } }));

    expect(observer.getReconstructed()).toBeNull();
  });

  test('retains the last metadata event across multiple frames', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    observer.feed(
      Buffer.concat([
        metadataFrame({ serviceTier: { type: 'default' } }),
        frame('messageStop', { stopReason: 'end_turn' }),
        metadataFrame({ serviceTier: { type: 'priority' } }),
      ])
    );

    expect(observer.getReconstructed()).toEqual({ serviceTier: { type: 'priority' } });
  });

  test('ignores a frame with a corrupted checksum without throwing', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    const good = metadataFrame({ serviceTier: { type: 'priority' } });
    const corrupted = Buffer.from(good);
    const last = corrupted.length - 1;
    corrupted[last] = (corrupted[last] ?? 0) ^ 0xff;

    expect(() => observer.feed(corrupted)).not.toThrow();
    expect(observer.getReconstructed()).toBeNull();
  });

  test('drops a truncated tail on close and keeps prior metadata', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    observer.feed(metadataFrame({ serviceTier: { type: 'priority' } }));
    const partial = metadataFrame({ serviceTier: { type: 'flex' } }).subarray(0, 20);

    observer.feed(partial);
    observer.close();

    expect(observer.getReconstructed()).toEqual({ serviceTier: { type: 'priority' } });
  });

  test('stops observing after close', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    observer.close();
    observer.feed(metadataFrame({ serviceTier: { type: 'priority' } }));

    expect(observer.getReconstructed()).toBeNull();
  });

  test('closes safely on an implausible declared frame length', () => {
    const observer = new BedrockEventStreamMetadataObserver();
    const bogus = Buffer.alloc(16);
    bogus.writeUInt32BE(0xffffffff, 0);

    expect(() => observer.feed(bogus)).not.toThrow();
    // Observer is closed; a subsequent valid frame must not revive it.
    observer.feed(metadataFrame({ serviceTier: { type: 'priority' } }));
    expect(observer.getReconstructed()).toBeNull();
  });
});
