import { afterEach, beforeEach, describe, expect, it, jest, mock, test } from 'bun:test';

import { FastifyInstance } from 'fastify';

import { advanceTimersByTimeAsync } from '../../../../test/test-utils';
import { setConfigForTesting } from '../../../config';
import { Dispatcher } from '../../../services/dispatch/dispatcher';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import type { UnifiedImageGenerationRequest } from '../../../types/unified';
import { registerImagesRoute } from '../images';

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

/**
 * Shape produced by `@fastify/multipart` when registered with
 * `attachFieldsToBody: true` (see packages/backend/src/index.ts): the
 * preValidation hook drains the request and hangs the parsed parts, keyed by
 * field name, off `request.body`.
 */
type AttachedMultipartBody = Record<string, MultipartPart | MultipartPart[]>;

type FakeRequest = {
  ip: string;
  headers: Record<string, string>;
  keyName: string;
  attribution: string | null;
  parts?: () => AsyncIterable<MultipartPart>;
  isMultipart?: () => boolean;
  body?: AttachedMultipartBody;
};

type FakeReply = {
  code: (statusCode: number) => FakeReply;
  send: (payload: unknown) => unknown;
  header: (name: string, value: string) => FakeReply;
};

type EditsHandler = (request: FakeRequest, reply: FakeReply) => Promise<unknown>;

describe('Images route telemetry', () => {
  beforeEach(() => setConfigForTesting({ providers: {}, models: {}, keys: {} } as any));
  afterEach(() => jest.useRealTimers());

  it.each(['/v1/images/generations', '/v1/images/edits'])(
    'cancels pending dispatch and cleans disconnect polling for %s',
    async (path) => {
      jest.useFakeTimers();
      let handler!: (request: any, reply: any) => Promise<unknown>;
      const fastify = {
        post: (registeredPath: string, callback: typeof handler) => {
          if (registeredPath === path) handler = callback;
        },
      } as unknown as FastifyInstance;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const dispatchImageGenerations = mock(
        (_request: UnifiedImageGenerationRequest, signal: AbortSignal) => {
          started();
          return new Promise((_, reject) =>
            signal.addEventListener(
              'abort',
              () =>
                reject(
                  Object.assign(new Error('Client disconnected'), {
                    routingContext: { statusCode: 499 },
                  })
                ),
              { once: true }
            )
          );
        }
      );
      const storage = {
        emitStartedAsync: mock(),
        emitUpdatedAsync: mock(),
        saveRequest: mock(),
        saveError: mock(),
      } as unknown as UsageStorageService;
      await registerImagesRoute(
        fastify,
        { dispatchImageGenerations } as unknown as Dispatcher,
        storage
      );
      const handle = { closed: false };
      const body = path.endsWith('/edits')
        ? {
            image: {
              type: 'file',
              fieldname: 'image',
              filename: 'image.png',
              mimetype: 'image/png',
              toBuffer: async () => Buffer.from('image'),
            },
            model: { type: 'field', fieldname: 'model', value: 'images' },
            prompt: { type: 'field', fieldname: 'prompt', value: 'a fox' },
          }
        : { model: 'images', prompt: 'a fox' };
      const reply: FakeReply = {
        header: mock(() => reply),
        code: mock(() => reply),
        send: mock(),
      };
      const result = handler(
        {
          headers: {},
          ip: '127.0.0.1',
          body,
          raw: { socket: { [Symbol('handle')]: handle } },
          isMultipart: () => true,
        },
        reply
      );
      await ready;
      handle.closed = true;
      await advanceTimersByTimeAsync(250);
      await result;
      expect(dispatchImageGenerations.mock.calls[0]![1].aborted).toBe(true);
      expect(reply.code).toHaveBeenCalledWith(499);
      expect(jest.getTimerCount()).toBe(0);
    }
  );
  it('returns promptly even when saveRequest is unresolved for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async () => ({
      created: 123,
      data: [{ b64_json: 'ZWRpdGVk' }],
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
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const saveRequest = mock(() => new Promise<void>(() => {}));
    const saveError = mock(async () => {});

    const mockUsageStorage = {
      saveRequest,
      saveError,
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
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
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    const outcome = await Promise.race([
      editsHandler!(request, reply).then(() => 'completed'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 60)),
    ]);

    expect(outcome).toBe('completed');
    expect(dispatchImageGenerations).toHaveBeenCalled();
    expect(replyState.statusCode).toBeUndefined();
    expect(replyState.payload).toMatchObject({
      created: 123,
      data: [{ b64_json: 'ZWRpdGVk' }],
    });
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

    const dispatchImageGenerations = mock(async () => ({
      created: 123,
      data: [{ b64_json: 'ZWRpdGVk' }],
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
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const saveRequest = mock(async () => {});
    const saveError = mock(async () => {});

    const startedEvents: Array<{ incomingApiType?: string }> = [];
    const updatedEvents: Array<{
      incomingModelAlias?: string;
      apiKey?: string;
      attribution?: string | null;
      provider?: string;
      selectedModelName?: string;
      canonicalModelName?: string;
    }> = [];

    const emitStartedAsync = mock((record: { incomingApiType?: string }) => {
      startedEvents.push(record);
    });
    const emitUpdatedAsync = mock(
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
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(dispatchImageGenerations).toHaveBeenCalled();
    expect(replyState.statusCode).toBeUndefined();
    expect(replyState.payload).toMatchObject({
      created: 123,
      data: [{ b64_json: 'ZWRpdGVk' }],
    });

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

  it('builds the generation IR from the multipart upload for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const imageBytes = Buffer.from('fake-image-data');
    const maskBytes = Buffer.from('fake-mask-data');

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      parts() {
        async function* iter(): AsyncIterable<MultipartPart> {
          yield {
            type: 'file',
            fieldname: 'image',
            filename: 'input.webp',
            mimetype: 'image/webp',
            toBuffer: async () => imageBytes,
          };
          yield {
            type: 'file',
            fieldname: 'mask',
            filename: 'mask.png',
            mimetype: 'image/png',
            toBuffer: async () => maskBytes,
          };
          yield { type: 'field', fieldname: 'prompt', value: 'add a hat' };
          yield { type: 'field', fieldname: 'model', value: 'image-model' };
          yield { type: 'field', fieldname: 'n', value: '2' };
          yield { type: 'field', fieldname: 'size', value: '1024x1024' };
          yield { type: 'field', fieldname: 'response_format', value: 'b64_json' };
          yield { type: 'field', fieldname: 'quality', value: 'high' };
          yield { type: 'field', fieldname: 'user', value: 'user_123' };
        }
        return iter();
      },
    };

    const reply: FakeReply = {
      code: mock(() => reply),
      send: mock((payload: unknown) => payload),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    const dispatched = dispatchImageGenerations.mock.calls[0]![0];
    expect(dispatched).toMatchObject({
      model: 'image-model',
      prompt: 'add a hat',
      n: 2,
      size: '1024x1024',
      response_format: 'b64_json',
      quality: 'high',
      user: 'user_123',
      incomingApiType: 'images',
    });
    expect(dispatched.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/webp;base64,${imageBytes.toString('base64')}` },
        media_type: 'image/webp',
      },
    ]);
    expect(dispatched.mask).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${maskBytes.toString('base64')}` },
      media_type: 'image/png',
    });
  });

  it('normalises an upload that arrives without an image MIME type', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    // curl's `-F image=@photo.webp` sends application/octet-stream.
    const webpBytes = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1'),
      Buffer.from('payload', 'latin1'),
    ]);
    const maskBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      parts() {
        async function* iter(): AsyncIterable<MultipartPart> {
          yield {
            type: 'file',
            fieldname: 'image',
            filename: 'photo.webp',
            mimetype: 'application/octet-stream',
            toBuffer: async () => webpBytes,
          };
          yield {
            type: 'file',
            fieldname: 'mask',
            filename: 'mask.png',
            mimetype: 'application/octet-stream',
            toBuffer: async () => maskBytes,
          };
          yield { type: 'field', fieldname: 'prompt', value: 'add a hat' };
          yield { type: 'field', fieldname: 'model', value: 'image-model' };
        }
        return iter();
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBeUndefined();
    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    const dispatched = dispatchImageGenerations.mock.calls[0]![0];
    expect(dispatched.input_references?.[0]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/webp;base64,${webpBytes.toString('base64')}` },
      media_type: 'image/webp',
    });
    expect(dispatched.mask?.media_type).toBe('image/png');
  });

  it('builds the generation IR from multipart fields attached to the body for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const imageBytes = Buffer.from('fake-image-data');

    // `attachFieldsToBody: true` consumes the body before the route runs, so
    // `request.parts()` is never available to the handler.
    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      body: {
        image: {
          type: 'file',
          fieldname: 'image',
          filename: 'input.png',
          mimetype: 'image/png',
          toBuffer: async () => imageBytes,
        },
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
        n: { type: 'field', fieldname: 'n', value: '2' },
        size: { type: 'field', fieldname: 'size', value: '1024x1024' },
        response_format: { type: 'field', fieldname: 'response_format', value: 'b64_json' },
        quality: { type: 'field', fieldname: 'quality', value: 'high' },
        user: { type: 'field', fieldname: 'user', value: 'user_123' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBeUndefined();
    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    const dispatched = dispatchImageGenerations.mock.calls[0]![0];
    expect(dispatched).toMatchObject({
      model: 'image-model',
      prompt: 'add a hat',
      n: 2,
      size: '1024x1024',
      response_format: 'b64_json',
      quality: 'high',
      user: 'user_123',
      incomingApiType: 'images',
    });
    expect(dispatched.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imageBytes.toString('base64')}` },
        media_type: 'image/png',
      },
    ]);
    expect(dispatched.mask).toBeUndefined();
  });

  it('reads the mask from attached body fields even when parts() is drained for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const imageBytes = Buffer.from('fake-image-data');
    const maskBytes = Buffer.from('fake-mask-data');
    const partsCalls = mock();

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      // The attach hook already exhausted the busboy stream, so parts() yields
      // nothing; the attached body has to win.
      parts() {
        partsCalls();
        async function* iter(): AsyncIterable<MultipartPart> {}
        return iter();
      },
      body: {
        image: {
          type: 'file',
          fieldname: 'image',
          filename: 'input.webp',
          mimetype: 'image/webp',
          toBuffer: async () => imageBytes,
        },
        mask: {
          type: 'file',
          fieldname: 'mask',
          filename: 'mask.png',
          mimetype: 'image/png',
          toBuffer: async () => maskBytes,
        },
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBeUndefined();
    expect(partsCalls).not.toHaveBeenCalled();
    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    const dispatched = dispatchImageGenerations.mock.calls[0]![0];
    expect(dispatched.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/webp;base64,${imageBytes.toString('base64')}` },
        media_type: 'image/webp',
      },
    ]);
    expect(dispatched.mask).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${maskBytes.toString('base64')}` },
      media_type: 'image/png',
    });
  });

  it('rejects an attached multipart body that has no image field for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      body: {
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBe(400);
    expect(replyState.payload).toMatchObject({
      error: { message: 'Missing required field: image', type: 'validation_error' },
    });
    expect(dispatchImageGenerations).not.toHaveBeenCalled();
  });

  it('collects every image[] file part into input_references for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const firstBytes = Buffer.from('fake-first-image');
    const secondBytes = Buffer.from('fake-second-image');

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      body: {
        'image[]': [
          {
            type: 'file',
            fieldname: 'image[]',
            filename: 'first.png',
            mimetype: 'image/png',
            toBuffer: async () => firstBytes,
          },
          {
            type: 'file',
            fieldname: 'image[]',
            filename: 'second.png',
            mimetype: 'image/png',
            toBuffer: async () => secondBytes,
          },
        ],
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBeUndefined();
    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    const dispatched = dispatchImageGenerations.mock.calls[0]![0];
    expect(dispatched.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${firstBytes.toString('base64')}` },
        media_type: 'image/png',
      },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${secondBytes.toString('base64')}` },
        media_type: 'image/png',
      },
    ]);
  });

  it('rejects a request that mixes image and image[] for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [{ b64_json: 'ZWRpdGVk' }],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const firstBytes = Buffer.from('fake-single-image');
    const secondBytes = Buffer.from('fake-array-image');

    // Keyed by raw field name, matching what @fastify/multipart produces for a
    // request that sends both spellings.
    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      body: {
        'image[]': [
          {
            type: 'file',
            fieldname: 'image[]',
            filename: 'second.png',
            mimetype: 'image/png',
            toBuffer: async () => secondBytes,
          },
        ],
        image: {
          type: 'file',
          fieldname: 'image',
          filename: 'first.png',
          mimetype: 'image/png',
          toBuffer: async () => firstBytes,
        },
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBe(400);
    expect(dispatchImageGenerations).not.toHaveBeenCalled();
  });

  it('rejects more than 16 image[] parts for /v1/images/edits', async () => {
    let editsHandler: EditsHandler | undefined;

    const fastify = {
      post(path: string, handler: EditsHandler) {
        if (path === '/v1/images/edits') {
          editsHandler = handler;
        }
      },
    } as unknown as FastifyInstance;

    const dispatchImageGenerations = mock(async (_request: UnifiedImageGenerationRequest) => ({
      created: 321,
      data: [],
      plexus: { provider: 'openai', model: 'gpt-image-1', apiType: 'images' },
    }));

    const mockDispatcher = {
      dispatchImageGenerations,
    } as unknown as Dispatcher;

    const mockUsageStorage = {
      saveRequest: mock(async () => {}),
      saveError: mock(async () => {}),
      emitStartedAsync: mock(() => {}),
      emitUpdatedAsync: mock(() => {}),
    } as unknown as UsageStorageService;

    await registerImagesRoute(fastify, mockDispatcher, mockUsageStorage);
    expect(editsHandler).toBeDefined();

    const imageBytes = Buffer.from('fake-image-data');

    const request: FakeRequest = {
      ip: '127.0.0.1',
      headers: {},
      keyName: 'test-key-1',
      attribution: null,
      isMultipart: () => true,
      body: {
        image: Array.from({ length: 17 }, (_, i) => ({
          type: 'file' as const,
          fieldname: 'image[]',
          filename: `ref-${i}.png`,
          mimetype: 'image/png',
          toBuffer: async () => imageBytes,
        })),
        model: { type: 'field', fieldname: 'model', value: 'image-model' },
        prompt: { type: 'field', fieldname: 'prompt', value: 'add a hat' },
      },
    };

    const replyState: { statusCode?: number; payload?: unknown } = {};
    const reply: FakeReply = {
      code: mock((statusCode: number) => {
        replyState.statusCode = statusCode;
        return reply;
      }),
      send: mock((payload: unknown) => {
        replyState.payload = payload;
        return payload;
      }),
      header: mock(() => reply),
    };

    await editsHandler!(request, reply);

    expect(replyState.statusCode).toBe(400);
    expect(replyState.payload).toMatchObject({
      error: { message: 'Too many image references (max 16)', type: 'validation_error' },
    });
    expect(dispatchImageGenerations).not.toHaveBeenCalled();
  });
});
