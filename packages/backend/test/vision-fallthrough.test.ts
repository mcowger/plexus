import { expect, test, describe, beforeEach, vi } from 'vitest';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';
import { Dispatcher } from '../src/services/dispatcher';
import { UnifiedChatRequest } from '../src/types/unified';
import * as configModule from '../src/config';
import { DEFAULT_VISION_DESCRIPTION_PROMPT } from '../src/utils/constants';

describe('Vision Fallthrough', () => {
  let mockRequest: UnifiedChatRequest;

  beforeEach(() => {
    mockRequest = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              },
            },
          ],
        },
      ],
    };
  });

  test('hasImages detects images in request', () => {
    expect(VisionDescriptorService.hasImages(mockRequest.messages)).toBe(true);

    const noImages = [{ role: 'user', content: 'hello' }];
    expect(VisionDescriptorService.hasImages(noImages as any)).toBe(false);
  });

  test('hasImages detects Anthropic-style images', () => {
    const anthropicRequest = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: '...' },
          } as any,
        ],
      },
    ];
    expect(VisionDescriptorService.hasImages(anthropicRequest as any)).toBe(true);
  });
});
