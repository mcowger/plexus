import { expect, test, describe, afterEach } from 'bun:test';
import { registerSpy } from './test-utils';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';
import { UnifiedMessage, UnifiedChatRequest, TextContent } from '../src/types/unified';

describe('VisionDescriptorService Detailed Verification', () => {
  afterEach(() => {
    // Restore all spies to prevent polluting other tests
    (VisionDescriptorService as any).describeImage.mockRestore?.();
  });
  test('injectDescriptions correctly replaces images with text', () => {
    const messages: UnifiedMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this:' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,123' } },
          { type: 'text', text: 'And this:' },
          {
            type: 'image',
            source: { type: 'base64', data: '456', media_type: 'image/png' },
          } as any,
        ],
      },
    ];

    const descriptions = ['A cute cat', 'A big dog'];

    // @ts-ignore - accessing private for testing
    const result = VisionDescriptorService.injectDescriptions(messages, descriptions);

    expect(result[0]?.content).toHaveLength(4);
    expect((result[0]?.content as any)[0]?.type).toBe('text');
    expect((result[0]?.content as any)[1]?.type).toBe('text');
    expect((result[0]?.content as any)[1]?.text).toContain('A cute cat');
    expect((result[0]?.content as any)[2]?.type).toBe('text');
    expect((result[0]?.content as any)[3]?.type).toBe('text');
    expect((result[0]?.content as any)[3]?.text).toContain('A big dog');

    // Verify no images left
    expect(VisionDescriptorService.hasImages(result)).toBe(false);
  });

  test('process correctly modifies the request object', async () => {
    const request: UnifiedChatRequest = {
      model: 'test',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:...' } }],
        },
      ],
    };

    // Mock describeImage to avoid Dispatcher dependency in this unit test
    registerSpy(VisionDescriptorService as any, 'describeImage').mockResolvedValue(
      'This is a description of an image.'
    );

    const result = await VisionDescriptorService.process(request, 'desc-model');

    expect(VisionDescriptorService.hasImages(result.messages)).toBe(false);
    expect(result.messages[0]?.content).toHaveLength(1);
    const firstContent = (result.messages[0]?.content as any)[0] as TextContent;
    expect(firstContent?.text).toContain('This is a description of an image.');
  });
});
