import { beforeEach, expect, type Mock, spyOn, test } from 'bun:test';

import { ProviderConfigSchema } from '../../../config';
import { ResponsesTransformer } from '../../../transformers/responses';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import * as discovery from '../../providers/provider-model-discovery';
import type { CodexReasoningCapabilities } from '../../providers/provider-model-discovery';
import type { RouteResult } from '../../routing/router';
import { buildRequestPayload } from '../request-payload-builder';

const luna = 'gpt-6-luna';
const sol = 'gpt-6.2-sol';
const userMessage = {
  type: 'message',
  role: 'user',
  content: [{ type: 'input_text', text: 'Continue.' }],
};
const update = (effort: string) => ({ type: 'configuration_update', reasoning: { effort } });
const lunaCapabilities: CodexReasoningCapabilities = {
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: 'medium',
  supportsEffortUpdates: false,
};
const authenticatedCatalog = {
  source: 'codex-backend' as const,
  models: [
    { id: luna, codexReasoning: lunaCapabilities },
    {
      id: sol,
      codexReasoning: {
        supportedEfforts: ['low', 'medium', 'xhigh', 'max', 'ultra', 'persistent', 'vendor-mode'],
        defaultEffort: 'low',
        supportsEffortUpdates: true,
        multiAgentEffort: 'xhigh',
      },
    },
  ],
};

let catalog: Mock<typeof discovery.listCodexOAuthModels>;

beforeEach(() => {
  OAuthAuthManager.resetForTesting();
  spyOn(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue('codex-test-access');
  catalog = spyOn(discovery, 'listCodexOAuthModels').mockResolvedValue(authenticatedCatalog);
});

function route(model: string, codex: boolean): RouteResult {
  return {
    provider: codex ? 'codex' : 'direct',
    model,
    config: ProviderConfigSchema.parse(
      codex
        ? {
            api_base_url: 'oauth://',
            oauth_provider: 'openai-codex',
            oauth_account: 'work',
            pi_ai_provider: 'openai-codex',
            auto_compat: true,
          }
        : { api_base_url: { responses: 'https://api.openai.com/v1' }, api_key: 'test-key' }
    ),
  };
}

async function build(body: Record<string, unknown>, codex = true) {
  const transformer = new ResponsesTransformer();
  const request = await transformer.parseRequest(body);
  request.incomingApiType = 'responses';
  request.originalBody = body;
  return (await buildRequestPayload(request, route(request.model, codex), transformer, 'responses'))
    .payload;
}

test('Luna replay strips saved updates on Codex without changing the Direct fallback', async () => {
  const body = {
    model: luna,
    reasoning: { effort: 'none', summary: 'detailed' },
    client_metadata: { turn_id: 'codex-replay' },
    input: [update('minimal'), userMessage],
  };
  const payload = await build(body);
  expect(payload.reasoning).toEqual({ effort: 'low', summary: 'detailed' });
  expect(payload.input).toEqual([userMessage]);
  expect(catalog).toHaveBeenCalledWith('work', { token: 'codex-test-access' });
  expect(body.input).toEqual([update('minimal'), userMessage]);
  expect(body.reasoning.effort).toBe('none');

  const direct = await build(body, false);
  expect(direct.reasoning.effort).toBe('none');
  expect(direct.input).toEqual(body.input);
});

test('uses the catalog of the selected Codex model for top-level and replayed effort', async () => {
  const body = {
    model: sol,
    reasoning: { effort: 'ultra' },
    input: [
      update('minimal'),
      update('high'),
      update('persistent'),
      update('disabled'),
      update('vendor-mode'),
      userMessage,
    ],
  };
  const payload = await build(body);
  expect(payload.reasoning.effort).toBe('xhigh');
  expect(payload.input).toEqual([
    update('low'),
    update('medium'),
    update('disabled'),
    update('disabled'),
    update('vendor-mode'),
    userMessage,
  ]);
  expect(body.input[0]).toEqual(update('minimal'));
  expect(body.input[2]).toEqual(update('persistent'));
});

test('leaves effort unset through fallback and uses bundled Luna limits during an outage', async () => {
  catalog.mockResolvedValue({ source: 'catalog', models: [], warning: 'offline' });
  const omitted = await build({
    model: luna,
    input: [userMessage],
    reasoning: { summary: 'auto' },
  });
  expect(omitted.reasoning).toEqual({ summary: 'auto' });
  expect(catalog).not.toHaveBeenCalled();

  const offline = await build({
    model: luna,
    input: [update('high'), userMessage],
    reasoning: { effort: 'none' },
  });
  expect(offline.reasoning.effort).toBe('low');
  expect(offline.input).toEqual([userMessage]);
});
