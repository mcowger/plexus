import { expect, test, describe } from 'bun:test';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';

describe('Vision Detection Reproduction', () => {
  test("detects images in the user's specific payload", () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'SNIP>' },
          { type: 'text', text: 'SNIP' },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: '...',
            signature: '...',
          },
          { type: 'text', text: '...' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '<attachments>\n' },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: 'base64datahereSNIP>gg==',
              media_type: 'image/png',
            },
          },
          { type: 'text', text: '\n</attachments>\n...' },
        ],
      },
    ];

    const hasImages = VisionDescriptorService.hasImages(messages as any);
    expect(hasImages).toBe(true);
  });
});
