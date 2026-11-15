import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { createParser } from 'eventsource-parser';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ProviderConfigSchema } from '../../src/config';
import { registerResponsesRoute } from '../../src/routes/inference/responses';
import type { Dispatcher } from '../../src/services/dispatch/dispatcher';
import { buildRequestPayload } from '../../src/services/dispatch/request-payload-builder';
import type { UsageStorageService } from '../../src/services/observability/usage-storage';
import { ResponsesStorageService } from '../../src/services/responses/responses-storage';
import { ResponsesTransformer } from '../../src/transformers/responses';
import type { ResponsesOutputItem } from '../../src/types/responses';
import type { UnifiedChatRequest, UnifiedChatResponse } from '../../src/types/unified';

const clientResponseSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  store: z.boolean(),
  output: z.array(z.unknown()),
});
const frameSchema = z.object({ type: z.string(), response: clientResponseSchema.optional() });
const message = (text: string) => ({
  type: 'message' as const,
  role: 'user' as const,
  content: [{ type: 'input_text' as const, text }],
});
const output = (text: string): ResponsesOutputItem[] => [
  {
    type: 'message',
    id: `msg_${crypto.randomUUID()}`,
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  },
];
const sse = (body: object) => `data: ${JSON.stringify(body)}\n\n`;

let app: FastifyInstance;
let storage: ResponsesStorageService;
let ids: string[];
let requests: UnifiedChatRequest[];
let native: boolean;
let nextOutput: ResponsesOutputItem[];

function responseFrom(body: string, stream = false) {
  if (!stream) return clientResponseSchema.parse(JSON.parse(body));
  const frames: z.infer<typeof frameSchema>[] = [];
  const parser = createParser({
    onEvent: ({ data }) => {
      if (data !== '[DONE]') frames.push(frameSchema.parse(JSON.parse(data)));
    },
  });
  parser.feed(body);
  const response = frames.find((frame) => frame.type === 'response.completed')?.response;
  if (!response) throw new Error('Missing completed response');
  return response;
}

async function post(body: Record<string, unknown>, expectedStatus = 200) {
  const result = await app.inject({
    method: 'POST',
    url: '/v1/responses',
    payload: { model: 'test-model', ...body },
  });
  expect(result.statusCode, result.body).toBe(expectedStatus);
  if (expectedStatus !== 200) return undefined;
  const response = responseFrom(result.body, body.stream === true);
  ids.push(response.id);
  return response;
}

beforeEach(async () => {
  storage = new ResponsesStorageService();
  ids = [];
  requests = [];
  native = true;
  nextOutput = output('answer');
  const dispatch = mock(async (request: UnifiedChatRequest): Promise<UnifiedChatResponse> => {
    requests.push(structuredClone(request));
    const id = `resp_native_${crypto.randomUUID()}`;
    const rawResponse = {
      id,
      object: 'response',
      created_at: 123,
      status: 'completed',
      model: 'test-model',
      output: nextOutput,
      store: false,
    };
    const base: UnifiedChatResponse = {
      id,
      model: 'test-model',
      content: 'translated answer',
      bypassTransformation: native,
      plexus: {
        provider: 'test-provider',
        model: 'test-model',
        apiType: native ? 'responses' : 'chat',
      },
    };
    if (request.stream) {
      const body = native
        ? sse({
            type: 'response.created',
            response: { ...rawResponse, status: 'in_progress', output: [] },
          }) + sse({ type: 'response.completed', response: rawResponse })
        : sse({
            id,
            model: 'test-model',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'translated answer' },
                finish_reason: null,
              },
            ],
          }) +
          sse({ id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) +
          'data: [DONE]\n\n';
      base.stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
    } else if (native) base.rawResponse = rawResponse;
    return base;
  });
  // Route dependencies have private service state; the test replaces only their public boundary.
  const dispatcher = { dispatch } as unknown as Dispatcher;
  const usage = {
    emitStartedAsync: mock(),
    emitUpdatedAsync: mock(),
    saveRequest: mock(async () => {}),
    saveError: mock(),
    updatePerformanceMetrics: mock(async () => {}),
    registerInFlight: mock(),
    deregisterInFlight: mock(),
  } as unknown as UsageStorageService;
  app = Fastify();
  await registerResponsesRoute(app, dispatcher, usage);
});

afterEach(async () => {
  await app.close();
  for (const id of ids) await storage.deleteResponse(id);
});

describe('Plexus-owned HTTP Responses state', () => {
  for (const bypass of [true, false])
    for (const stream of [false, true]) {
      test(`stores the delivered ID and output before completion (native:${bypass}, stream:${stream})`, async () => {
        native = bypass;
        const response = await post({ input: 'first user input', store: true, stream });
        if (!response) throw new Error('Missing response');
        expect(response.store).toBe(true);
        const retrieved = await app.inject({ method: 'GET', url: `/v1/responses/${response.id}` });
        expect(retrieved.statusCode).toBe(200);
        expect(retrieved.json()).toMatchObject({
          id: response.id,
          output: response.output,
          store: true,
        });
        const row = await storage.getResponse(response.id);
        expect(JSON.parse(row.inputItems)).toEqual([message('first user input')]);
        expect(requests[0]?.originalBody.store).toBe(false);
        expect(requests[0]?.originalBody.include).toContain('reasoning.encrypted_content');
      });
    }

  for (const stream of [false, true])
    for (const store of [undefined, false]) {
      test(`does not retain omitted/false store (store:${store}, stream:${stream})`, async () => {
        const response = await post({
          input: 'private turn',
          stream,
          ...(store === undefined ? {} : { store }),
        });
        if (!response) throw new Error('Missing response');
        expect(response.store).toBe(false);
        expect(
          (await app.inject({ method: 'GET', url: `/v1/responses/${response.id}` })).statusCode
        ).toBe(404);
        await post({ input: 'next', previous_response_id: response.id }, 404);
        expect(requests).toHaveLength(1);
      });
    }

  for (const stream of [false, true]) {
    test(`replays three turns including original users, reasoning and tools exactly once (stream:${stream})`, async () => {
      nextOutput = [
        { type: 'reasoning', id: 'rs_opaque', encrypted_content: 'opaque', summary: [] },
        {
          type: 'function_call',
          id: 'fc_native',
          call_id: 'call_lookup',
          name: 'lookup',
          arguments: '{}',
        },
      ];
      const firstOutput = structuredClone(nextOutput);
      const first = await post({
        input: 'remember SAPPHIRE',
        instructions: 'first instructions',
        store: true,
        stream,
      });
      if (!first) throw new Error('Missing response');
      const toolResult = {
        type: 'function_call_output',
        call_id: 'call_lookup',
        output: 'lookup result',
      };
      nextOutput = [
        {
          type: 'function_call',
          id: 'fc_second',
          call_id: 'call_second',
          name: 'lookup',
          arguments: '{}',
        },
      ];
      const secondOutput = structuredClone(nextOutput);
      const second = await post({
        input: [toolResult, message('remember COBALT')],
        previous_response_id: first.id,
        store: true,
        stream,
      });
      if (!second) throw new Error('Missing response');
      const secondRequest = requests[1]?.originalBody;
      expect(secondRequest.input).toEqual([
        message('remember SAPPHIRE'),
        ...firstOutput,
        toolResult,
        message('remember COBALT'),
      ]);
      expect(secondRequest.previous_response_id).toBeUndefined();
      expect(secondRequest.instructions).toBeUndefined();
      nextOutput = output('third answer');
      const secondToolResult = {
        type: 'function_call_output',
        call_id: 'call_second',
        output: 'second lookup result',
      };
      const third = await post({
        input: [secondToolResult, message('return both words')],
        previous_response_id: second.id,
        store: false,
        stream,
      });
      if (!third) throw new Error('Missing response');
      expect(requests[2]?.originalBody.input).toEqual([
        message('remember SAPPHIRE'),
        ...firstOutput,
        toolResult,
        message('remember COBALT'),
        ...secondOutput,
        secondToolResult,
        message('return both words'),
      ]);
      expect(requests[2]?.originalBody.previous_response_id).toBeUndefined();
      expect(third.store).toBe(false);
      expect(await storage.getResponse(third.id)).toBeNull();
    });
  }

  test('rejects unknown and legacy predecessor IDs without dispatching partial context', async () => {
    await post({ previous_response_id: 'resp_missing', input: 'next' }, 404);
    const id = `resp_legacy_${crypto.randomUUID()}`;
    ids.push(id);
    await storage.storeResponse(
      {
        id,
        object: 'response',
        created_at: 123,
        status: 'completed',
        model: 'test-model',
        output: output('legacy'),
      },
      { store: true }
    );
    await post({ previous_response_id: id, input: 'next' }, 404);
    expect(requests).toHaveLength(0);
  });

  test('does not advertise unary success when storage fails', async () => {
    spyOn(ResponsesStorageService.prototype, 'storeResponse').mockRejectedValue(
      new Error('storage unavailable')
    );
    const result = await app.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: { model: 'test-model', input: 'first', store: true },
    });
    expect(result.statusCode).toBe(500);
    expect(result.json().error.message).toBe('storage unavailable');
  });

  test('configuration cannot re-enable upstream persistence or inject a native predecessor', async () => {
    const transformer = new ResponsesTransformer();
    const request = await transformer.parseRequest({
      model: 'test-model',
      input: [message('full replay')],
      store: false,
    });
    request.incomingApiType = 'responses';
    request.originalBody = { model: 'test-model', input: [message('full replay')], store: false };
    const result = await buildRequestPayload(
      request,
      {
        provider: 'test-provider',
        model: 'test-model',
        config: ProviderConfigSchema.parse({
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'test',
          models: {},
          extraBody: { store: true, previous_response_id: 'resp_foreign' },
        }),
      },
      transformer,
      'responses'
    );
    expect(result.payload.store).toBe(false);
    expect(result.payload.previous_response_id).toBeUndefined();
    expect(result.payload.input).toEqual([message('full replay')]);
  });
});
