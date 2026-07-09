import { describe, expect, test } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { TransformerFactory } from '../transformer-factory';

function makeRoute(
  accessVia: any[],
  apiBaseUrl: string | Record<string, string> = 'https://api.test/v1'
) {
  return {
    provider: 'test-provider',
    model: 'upstream-model',
    config: {
      api_base_url: apiBaseUrl,
      api_key: 'test-key',
      models: {},
    },
    modelConfig: {
      pricing: { source: 'simple', input: 0, output: 0 },
      access_via: accessVia,
    },
  } as any;
}

describe('Dispatcher API subtypes', () => {
  test('does not match Responses Lite to an ordinary Responses target', () => {
    const dispatcher = new Dispatcher() as any;
    const selection = dispatcher.selectTargetApiType(
      makeRoute(['chat', 'responses']),
      'responses:lite'
    );

    expect(selection.targetApiType).toBeUndefined();
    expect(selection.selectionReason).toContain("subtype 'responses:lite' is not supported");
  });

  test('selects an explicitly configured structured subtype', () => {
    const dispatcher = new Dispatcher() as any;
    const selection = dispatcher.selectTargetApiType(
      makeRoute([{ type: 'responses', subtype: 'lite' }]),
      'responses:lite'
    );

    expect(selection.targetApiType).toBe('responses:lite');
  });

  test('uses the base Responses URL and forwards the Lite header', () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }], {
      responses: 'https://api.test/v1',
    });

    expect(dispatcher.resolveBaseUrl(route, 'responses:lite')).toBe('https://api.test/v1');
    expect(
      dispatcher.setupHeaders(route, 'responses:lite', { model: 'alias', messages: [] })
    ).toMatchObject({
      Authorization: 'Bearer test-key',
      'x-openai-internal-codex-responses-lite': 'true',
    });
  });

  test('keeps a Lite request body in the Responses pass-through path', async () => {
    const dispatcher = new Dispatcher() as any;
    const route = makeRoute([{ type: 'responses', subtype: 'lite' }]);
    const originalBody = {
      model: 'alias',
      input: [{ type: 'additional_tools', role: 'developer', tools: [] }],
    };
    const result = await dispatcher.transformRequestPayload(
      {
        model: 'alias',
        messages: [],
        incomingApiType: 'responses:lite',
        originalBody,
      },
      route,
      TransformerFactory.getTransformer('responses:lite'),
      'responses:lite'
    );

    expect(result.bypassTransformation).toBe(true);
    expect(result.payload.input).toEqual(originalBody.input);
    expect(result.payload.model).toBe('upstream-model');
  });
});
