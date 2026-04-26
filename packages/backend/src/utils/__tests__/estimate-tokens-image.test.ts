import { afterEach, describe, expect, test } from 'vitest';
import {
  __setEncoderFailedForTests,
  estimateImageTokens,
  estimateInputTokens,
  estimateTokens,
  estimateTokensHeuristic,
  getImageDimensionsFromBuffer,
  getImageDimensionsFromDataUri,
} from '../estimate-tokens';

// ---------- helpers: synthesize minimal valid image headers ----------

function makePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  // PNG signature
  buf.writeUInt8(0x89, 0);
  buf.writeUInt8(0x50, 1);
  buf.writeUInt8(0x4e, 2);
  buf.writeUInt8(0x47, 3);
  buf.writeUInt8(0x0d, 4);
  buf.writeUInt8(0x0a, 5);
  buf.writeUInt8(0x1a, 6);
  buf.writeUInt8(0x0a, 7);
  // IHDR length + type
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  // width @16, height @20
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function makeGif(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function makeJpeg(width: number, height: number): Buffer {
  // SOI + APP0 (minimal) + SOF0 with width/height + EOI
  const segLen = 17;
  const buf = Buffer.alloc(2 + 2 + segLen + 2 + segLen + 2);
  let i = 0;
  // SOI
  buf[i++] = 0xff;
  buf[i++] = 0xd8;
  // APP0 marker
  buf[i++] = 0xff;
  buf[i++] = 0xe0;
  buf.writeUInt16BE(segLen, i);
  i += 2;
  // 17 bytes of payload (junk that satisfies length)
  buf.fill(0, i, i + segLen - 2);
  i += segLen - 2;
  // SOF0 marker
  buf[i++] = 0xff;
  buf[i++] = 0xc0;
  buf.writeUInt16BE(segLen, i);
  i += 2;
  // precision (1 byte)
  buf[i++] = 8;
  // height (2 bytes BE)
  buf.writeUInt16BE(height, i);
  i += 2;
  // width (2 bytes BE)
  buf.writeUInt16BE(width, i);
  i += 2;
  // Pad rest of segment
  buf.fill(0, i, 2 + 2 + segLen + 2 + segLen);
  i = 2 + 2 + segLen + 2 + segLen;
  // EOI
  buf[i++] = 0xff;
  buf[i++] = 0xd9;
  return buf;
}

function makeWebpVP8X(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4); // file size minus 8 (placeholder)
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16); // chunk size
  buf[20] = 0; // flags
  buf[21] = 0;
  buf[22] = 0;
  buf[23] = 0;
  // canvas width-1 (3 bytes LE)
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

function dataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

// ---------- tokenizer + heuristic fallback ----------

describe('tokenizer (o200k_base) + heuristic fallback', () => {
  afterEach(() => {
    __setEncoderFailedForTests(false);
  });

  test('o200k_base counts known short strings deterministically', () => {
    // These counts are stable for o200k_base.
    expect(estimateTokens('Hello, world!')).toBe(4);
    expect(estimateTokens('function test() { return 1; }')).toBe(9);
  });

  test('falls back to heuristic when encoder is unavailable', () => {
    __setEncoderFailedForTests(true);
    const heuristic = estimateTokensHeuristic('Hello, world!');
    expect(estimateTokens('Hello, world!')).toBe(heuristic);
  });

  test('heuristic still produces non-zero for non-empty text', () => {
    expect(estimateTokensHeuristic('hello')).toBeGreaterThan(0);
    expect(estimateTokensHeuristic('')).toBe(0);
  });
});

// ---------- image dimension sniffing ----------

describe('getImageDimensionsFromBuffer', () => {
  test('PNG', () => {
    expect(getImageDimensionsFromBuffer(makePng(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  test('GIF', () => {
    expect(getImageDimensionsFromBuffer(makeGif(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  test('JPEG (SOF0)', () => {
    expect(getImageDimensionsFromBuffer(makeJpeg(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
  });

  test('WebP (VP8X)', () => {
    expect(getImageDimensionsFromBuffer(makeWebpVP8X(2000, 1500))).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  test('returns null on too-small buffer', () => {
    expect(getImageDimensionsFromBuffer(Buffer.alloc(4))).toBeNull();
  });

  test('returns null on unrecognized format', () => {
    expect(getImageDimensionsFromBuffer(Buffer.from('not an image at all here'))).toBeNull();
  });
});

describe('getImageDimensionsFromDataUri', () => {
  test('PNG data URI round-trip', () => {
    expect(getImageDimensionsFromDataUri(dataUri('image/png', makePng(512, 256)))).toEqual({
      width: 512,
      height: 256,
    });
  });

  test('returns null on non-data URI', () => {
    expect(getImageDimensionsFromDataUri('https://example.com/x.png')).toBeNull();
  });

  test('returns null on truncated payload', () => {
    expect(getImageDimensionsFromDataUri('data:image/png;base64,iVBOR')).toBeNull();
  });

  test('returns null on garbage payload', () => {
    expect(getImageDimensionsFromDataUri('data:image/png;base64,!!!notbase64!!!')).toBeNull();
  });
});

// ---------- per-provider image cost ----------

describe('estimateImageTokens', () => {
  test('Gemini is fixed 258 regardless of image', () => {
    expect(
      estimateImageTokens({ dataUri: dataUri('image/png', makePng(100, 100)) }, 'gemini')
    ).toBe(258);
    expect(estimateImageTokens({}, 'gemini')).toBe(258);
  });

  test('Claude (messages) uses (w*h)/750, capped at 1600', () => {
    // Tiny image: 100*100/750 = 14, ceil to 14
    expect(
      estimateImageTokens({ dataUri: dataUri('image/png', makePng(100, 100)) }, 'messages')
    ).toBe(14);
    // Large image hits cap
    expect(
      estimateImageTokens({ dataUri: dataUri('image/png', makePng(2000, 2000)) }, 'messages')
    ).toBe(1600);
    // Unknown dimensions falls back to default
    expect(estimateImageTokens({ url: 'https://x.com/y.png' }, 'messages')).toBe(1600);
  });

  test('OpenAI (chat) low detail is 85', () => {
    expect(
      estimateImageTokens(
        { dataUri: dataUri('image/png', makePng(2000, 2000)), detail: 'low' },
        'chat'
      )
    ).toBe(85);
  });

  test('OpenAI (chat) high detail is tile-based with 2048+768 scaling', () => {
    // 1024x1024 fits within 2048, then short side already <=768? short=1024>768,
    // scales to 768x768 → ceil(768/512)*ceil(768/512) = 2*2 = 4 tiles
    // 85 + 170*4 = 765
    expect(
      estimateImageTokens(
        { dataUri: dataUri('image/png', makePng(1024, 1024)), detail: 'high' },
        'chat'
      )
    ).toBe(765);
  });

  test('OpenAI (chat) external URL uses conservative default', () => {
    expect(estimateImageTokens({ url: 'https://x.com/y.png' }, 'chat')).toBe(1100);
  });
});

// ---------- structural walker: image + text in each format ----------

describe('estimateInputTokens — image accounting', () => {
  const png = dataUri('image/png', makePng(1024, 1024));

  test('OpenAI chat: image_url part is counted as image tokens, not as base64 text', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image_url', image_url: { url: png, detail: 'high' } },
          ],
        },
      ],
    };
    const total = estimateInputTokens(body, 'chat');
    // Image alone for high detail at 1024x1024 → 765; total includes a few
    // tokens for the role + short caption.
    expect(total).toBeGreaterThanOrEqual(765);
    expect(total).toBeLessThan(800);
  });

  test('Anthropic messages: image source.base64 is sniffed for dimensions', () => {
    const pngBytes = makePng(750, 750);
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: pngBytes.toString('base64'),
              },
            },
          ],
        },
      ],
    };
    const total = estimateInputTokens(body, 'messages');
    // 750*750/750 = 750 tokens for the image.
    expect(total).toBeGreaterThanOrEqual(750);
    expect(total).toBeLessThan(900);
  });

  test('Gemini: inlineData contributes fixed 258 per image', () => {
    const pngBytes = makePng(640, 480);
    const body = {
      contents: [
        {
          parts: [
            { text: 'caption' },
            {
              inlineData: { mimeType: 'image/png', data: pngBytes.toString('base64') },
            },
          ],
        },
      ],
    };
    const total = estimateInputTokens(body, 'gemini');
    expect(total).toBeGreaterThanOrEqual(258);
    expect(total).toBeLessThan(280);
  });

  test('OpenAI Responses: input_image part counted by formula', () => {
    const body = {
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe' },
            { type: 'input_image', image_url: png, detail: 'low' },
          ],
        },
      ],
    };
    const total = estimateInputTokens(body, 'responses');
    // low-detail image is 85 + small text overhead
    expect(total).toBeGreaterThanOrEqual(85);
    expect(total).toBeLessThan(120);
  });

  test('does not blow up on a 1MB-ish base64 payload (regression: old path counted ~330k tokens)', () => {
    const big = makePng(2000, 2000);
    // Pad with extra base64 bytes to simulate a large encoded body
    const fakeBig = Buffer.concat([big, Buffer.alloc(800_000, 0)]);
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe' },
            { type: 'image_url', image_url: { url: dataUri('image/png', fakeBig) } },
          ],
        },
      ],
    };
    const total = estimateInputTokens(body, 'chat');
    // Should be in the low thousands at most, NOT hundreds of thousands.
    expect(total).toBeLessThan(5_000);
  });
});
