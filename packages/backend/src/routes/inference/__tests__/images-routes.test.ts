import { describe, it, expect, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { registerImagesRoute } from '../images';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';

type MultipartFilePart = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
};

type MultipartFieldPart = {
  type: 'field';
  fieldname: string;
  value: string;
};

type MultipartPart = MultipartFilePart | MultipartFieldPart;

type FakeRequest = {
  ip: string;
  headers: Record<string, string>;
  keyName: string;
  attribution: string | null;
  parts: () => AsyncIterable<MultipartPart>;
};

type FakeReply = {
  code: (statusCode: number) => FakeReply;
  send: (payload: unknown) => unknown;
  header: (name: string, value: string) => FakeReply;
};

type EditsHandler = (request: FakeRequest, reply: FakeReply) => Promise<unknown>;

describe('Images route telemetry', () => {
  it('returns promptly even when saveRequest is unresolved for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageEdits = vi.fn(async () => ({
      created: 123,
      data: [{ url: 'https://example.com/edited.png' }],
      usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
      plexus: {
        provider: 'openai',
        model: 'gpt-image-1',
        apiType: 'images',
        canonicalModel: 'image-model',
        pricing: { source: 'simple', input: 0.005, output: 0.015 },
      },
    }));

    const mockDispatcher = {
      dispatchImageEdits,
    } as unknown as Dispatcher;

    const saveRequest = vi.fn(() => new Promise<void>(() => {}));
    const saveError = vi.fn(async () => {});

    const mockUsageStorage = {
      saveRequest,
      saveError,
      emitStartedAsync: vi.fn(() => {}),
      emitUpdatedAsync: vi.fn(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: 'copilot',
      parts() {
        async function* iter(): AsyncIterable<MultipartPart> {
          yield {
            type: 'file',
            fieldname: 'image',
            filename: 'input.png',
            mimetype: 'image/png',
            toBuffer: async () => Buffer.from('fake-image-data'),
          };
          yield { type: 'field', fieldname: 'prompt', value: 'add a hat' };
          yield { type: 'field', fieldname: 'model', value: 'image-model' };
        }
        return iter();
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: vi.fn((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: vi.fn((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: vi.fn(() => reply),
    };

    const outcome = await Promise.race([
      editsHandler!(request, reply).then(() => 'completed'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 60)),
    ]);

    expect(outcome).toBe('completed');
    expect(dispatchImageEdits).toHaveBeenCalled();
    expect(replyState.statusCode).toBeUndefined();
    expect((replyState.payload as { data?: Array<{ url?: string }> })?.data?.[0]?.url).toBe(
      'https://example.com/edited.png'
    );
  });

  it('emits non-blocking started/updated telemetry for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageEdits = vi.fn(async () => ({
      created: 123,
      data: [{ url: 'https://example.com/edited.png' }],
      usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
      plexus: {
        provider: 'openai',
        model: 'gpt-image-1',
        apiType: 'images',
        canonicalModel: 'image-model',
        pricing: { source: 'simple', input: 0.005, output: 0.015 },
      },
    }));

    const mockDispatcher = {
      dispatchImageEdits,
    } as unknown as Dispatcher;

    const saveRequest = vi.fn(async () => {});
    const saveError = vi.fn(async () => {});

    const startedEvents: Array<{ incomingApiType?: string }> = [];
    const updatedEvents: Array<{
      incomingModelAlias?: string;
      apiKey?: string;
      attribution?: string | null;
      provider?: string;
      selectedModelName?: string;
      canonicalModelName?: string;
    }> = [];

    const emitStartedAsync = vi.fn((record: { incomingApiType?: string }) => {
      startedEvents.push(record);
    });
    const emitUpdatedAsync = vi.fn(
      (record: {
        incomingModelAlias?: string;
        apiKey?: string;
        attribution?: string | null;
        provider?: string;
        selectedModelName?: string;
        canonicalModelName?: string;
      }) => {
        updatedEvents.push(record);
      }
    );

    const mockUsageStorage = {
      saveRequest,
      saveError,
      emitStartedAsync,
      emitUpdatedAsync,
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);

    expect(editsHandler).toBeDefined();

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: 'copilot',
      parts() {
        async function* iter(): AsyncIterable<MultipartPart> {
          yield {
            type: 'file',
            fieldname: 'image',
            filename: 'input.png',
            mimetype: 'image/png',
            toBuffer: async () => Buffer.from('fake-image-data'),
          };
          yield { type: 'field', fieldname: 'prompt', value: 'add a hat' };
          yield { type: 'field', fieldname: 'model', value: 'image-model' };
        }
        return iter();
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: vi.fn((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: vi.fn((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: vi.fn(() => reply),
    };

    await editsHandler!(request, reply);

    expect(dispatchImageEdits).toHaveBeenCalled();
    expect(replyState.statusCode).toBeUndefined();
    expect((replyState.payload as { data?: Array<{ url?: string }> })?.data?.[0]?.url).toBe(
      'https://example.com/edited.png'
    );

    expect(emitStartedAsync).toHaveBeenCalledTimes(1);
    expect(emitUpdatedAsync).toHaveBeenCalledTimes(2);

    expect(startedEvents.length).toBe(1);
    expect(updatedEvents.length).toBe(2);

    const startedRecord = startedEvents[0];
    expect(startedRecord).toBeDefined();
    expect(startedRecord?.incomingApiType).toBe('images');

    const firstUpdate = updatedEvents[0];
    expect(firstUpdate).toBeDefined();
    expect(firstUpdate?.incomingModelAlias).toBe('image-model');
    expect(firstUpdate?.apiKey).toBe('test-key-1');
    expect(firstUpdate?.attribution).toBe('copilot');

    const secondUpdate = updatedEvents[1];
    expect(secondUpdate).toBeDefined();
    expect(secondUpdate?.provider).toBe('openai');
    expect(secondUpdate?.selectedModelName).toBe('gpt-image-1');
    expect(secondUpdate?.canonicalModelName).toBe('image-model');
  });
});
