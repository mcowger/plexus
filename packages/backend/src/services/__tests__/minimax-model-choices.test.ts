import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerModelRoutes } from '../../routes/management/models';
import { getCatalogModel } from '../pi-ai/catalog';
import {
  getSuggestedChatModels,
  selectMiniMaxChatChoices,
} from '../providers/minimax-model-choices';
import { discoverProviderModels, fetchModelsFromUrl } from '../providers/provider-model-discovery';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import { ConcurrencyTracker } from '../runtime/concurrency-tracker';

// Exercise the installed catalog rather than the suite's generic Claude fixture.
vi.unmock('@earendil-works/pi-ai');
vi.unmock('@earendil-works/pi-ai/providers/all');
vi.unmock('@earendil-works/pi-ai/compat');

const CURRENT = ['MiniMax-M3.1-Flash', 'MiniMax-M3'];

afterEach(() => {
  vi.unstubAllGlobals();
  ConcurrencyTracker.resetForTesting();
});

describe('MiniMax ordinary model choices', () => {
  it.each(['minimax', 'minimax-cn'])(
    'serves Flash first for %s without losing legacy lookup',
    async (provider) => {
      const app = Fastify();
      await registerModelRoutes(app);
      try {
        const response = await app.inject(`/v0/management/pi/models?provider=${provider}`);
        expect(response.statusCode).toBe(200);
        expect(response.json().data.map((model: { id: string }) => model.id)).toEqual(CURRENT);
        expect(getCatalogModel(provider, 'MiniMax-M2.7')?.id).toBe('MiniMax-M2.7');
        const flash = response.json().data[0];
        expect(flash).not.toHaveProperty('cost');
        expect(flash).not.toHaveProperty('maxTokens');
      } finally {
        await app.close();
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json({
            data: [{ id: 'MiniMax-M2.7' }, { id: 'MiniMax-M3' }, { id: 'MiniMax-M3.1-Flash' }],
          })
        )
      );
      const host = provider === 'minimax' ? 'api.minimax.io' : 'api.minimaxi.com';
      const result = await discoverProviderModels({ api_base_url: `https://${host}/v1` } as any);
      expect(result.map((model) => model.id)).toEqual(CURRENT);
    }
  );

  it('filters only known chat choices and never synthesizes gateway Flash IDs', () => {
    const models = [
      { id: 'minimax/minimax-m2.7' },
      { id: 'minimax/minimax-m2.5-highspeed' },
      { id: 'minimax/minimax-m1' },
      { id: 'minimax/minimax-text-01' },
      { id: 'minimax/minimax-01' },
      { id: 'minimax/abab6.5-chat' },
      { id: 'minimax/minimax-m3' },
      { id: 'minimax/speech-02-hd' },
      { id: 'minimax/video-01', type: 'video' },
      { id: 'custom-model' },
      { id: 'other/model' },
    ];
    expect(selectMiniMaxChatChoices(models, 'openrouter').map((model) => model.id)).toEqual([
      'minimax/minimax-m3',
      'minimax/speech-02-hd',
      'minimax/video-01',
      'custom-model',
      'other/model',
    ]);
    expect(selectMiniMaxChatChoices(models, 'custom-proxy')).toEqual(models);
    expect(
      selectMiniMaxChatChoices(
        [{ id: 'minimax/minimax-m3' }, { id: 'minimax/minimax-m3.1-flash:free' }],
        'openrouter'
      ).map((model) => model.id)
    ).toEqual(['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3']);
  });

  it('filters advertised gateway models at the HTTP discovery boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            { id: 'minimax/minimax-m2.7' },
            { id: 'minimax/minimax-m3' },
            { id: 'other/model' },
          ],
        })
      )
    );
    expect((await fetchModelsFromUrl('https://openrouter.ai/api/v1/models')).data).toEqual([
      { id: 'minimax/minimax-m3' },
      { id: 'other/model' },
    ]);
  });
});

describe('MiniMax serialized upstream requests', () => {
  it.each([
    ['openrouter', 'https://openrouter.ai/api/v1', 'minimax/minimax-m3'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'minimax/minimax-m3.1-flash:free'],
    ['opencode', 'https://opencode.ai/zen/v1', 'minimax-m3.1-flash-free'],
  ])('preserves the advertised %s gateway ID %s %s', async (provider, baseUrl, model) => {
    const selected = selectMiniMaxChatChoices([{ id: model }], provider)[0]!;
    setConfigForTesting({
      providers: {
        [provider]: {
          api_base_url: { chat: baseUrl },
          api_key: 'test-key',
          models: { [selected.id]: { access_via: ['chat'] } },
        },
      },
      models: { assistant: { selector: 'in_order', targets: [{ provider, model: selected.id }] } },
      keys: {},
      quotas: [],
      failover: { enabled: false },
    } as any);
    const fetchMock = vi.fn().mockImplementation(async () =>
      Response.json({
        id: 'test',
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await new Dispatcher().dispatch({
      model: 'assistant',
      incomingApiType: 'chat',
      stream: false,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/chat/completions`);
    expect(JSON.parse(init.body as string).model).toBe(model);
  });

  for (const provider of ['minimax', 'minimax-cn']) {
    for (const protocol of ['chat', 'messages']) {
      it.each(['default', 'MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'my-custom-model'])(
        `${provider} ${protocol} preserves %s at fetch`,
        async (selection) => {
          const model =
            selection === 'default' ? getSuggestedChatModels(provider)[0]!.id : selection;
          const host = provider === 'minimax' ? 'api.minimax.io' : 'api.minimaxi.com';
          const baseUrl = `https://${host}${protocol === 'messages' ? '/anthropic/v1' : '/v1'}`;
          setConfigForTesting({
            providers: {
              [provider]: {
                api_base_url: { [protocol]: baseUrl },
                api_key: 'test-key',
                pi_ai_provider: provider,
                auto_compat: selection === 'default' || selection.startsWith('MiniMax-M3'),
                models: { [model]: { access_via: [protocol], pi_ai_model_id: model } },
              },
            },
            models: { assistant: { selector: 'in_order', targets: [{ provider, model }] } },
            keys: {},
            quotas: [],
            failover: { enabled: false },
          } as any);
          const fetchMock = vi.fn().mockImplementation(async () =>
            Response.json(
              protocol === 'messages'
                ? {
                    id: 'test',
                    type: 'message',
                    role: 'assistant',
                    model,
                    content: [{ type: 'text', text: 'Hello' }],
                    stop_reason: 'end_turn',
                    usage: { input_tokens: 1, output_tokens: 1 },
                  }
                : {
                    id: 'test',
                    object: 'chat.completion',
                    model,
                    choices: [
                      {
                        index: 0,
                        message: { role: 'assistant', content: 'Hello' },
                        finish_reason: 'stop',
                      },
                    ],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                  }
            )
          );
          vi.stubGlobal('fetch', fetchMock);
          const imageUrl = 'https://example.com/image.png';
          const messages = [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: 'Hello' },
                { type: 'image_url' as const, image_url: { url: imageUrl } },
              ],
            },
          ];
          const originalBody = {
            model: 'assistant',
            stream: false,
            messages:
              protocol === 'messages'
                ? [
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: 'Hello' },
                        { type: 'image', source: { type: 'url', url: imageUrl } },
                      ],
                    },
                  ]
                : messages,
            ...(selection === 'default'
              ? {}
              : protocol === 'messages'
                ? { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
                : { reasoning_effort: 'high' }),
          };
          await new Dispatcher().dispatch({
            model: 'assistant',
            incomingApiType: protocol,
            stream: false,
            messages,
            originalBody,
          });
          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
          expect(url).toBe(
            `${baseUrl}${protocol === 'messages' ? '/messages' : '/chat/completions'}`
          );
          const payload = JSON.parse(init.body as string);
          expect(payload.model).toBe(model);
          expect(payload.messages).toEqual(originalBody.messages);
          if (selection === 'default') {
            expect(payload).not.toHaveProperty('thinking');
            expect(payload).not.toHaveProperty('reasoning_effort');
            expect(payload).not.toHaveProperty('output_config');
          } else if (protocol === 'messages') {
            expect(payload.thinking).toEqual({ type: 'adaptive' });
            expect(payload.output_config).toEqual({ effort: 'high' });
          } else {
            expect(payload.reasoning_effort).toBe('high');
          }
          expect(payload).not.toHaveProperty('service_tier');
          expect(payload).not.toHaveProperty('reasoning_split');
          expect(model).toBe(selection === 'default' ? 'MiniMax-M3.1-Flash' : selection);
        }
      );
    }
  }
});
