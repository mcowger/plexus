import { describe, expect, it } from 'vitest';
import presets from '../../../../data/provider-presets.json';
import type { ModelConfig, ProviderConfig } from '../../../config';
import { registerSpy } from '../../../../test/test-utils';
import * as registry from '../../pi-ai/registry';
import { resolveAliasServiceTiers } from '../alias-service-tiers';

function alias(
  targets: Array<{
    provider?: string;
    model?: string;
    alias?: string;
    enabled?: boolean;
  }>
) {
  return {
    target_groups: [{ name: 'primary', selector: 'in_order', targets }],
  } as ModelConfig;
}

function provider(map?: Record<string, string | null>): ProviderConfig {
  return {
    api_base_url: { responses: 'https://example.test/v1' },
    auto_compat: true,
    pi_ai_quirks: {
      responses: {
        api: 'openai-responses',
        ...(map && {
          models: {
            custom: { serviceTierMap: map },
            'gpt-6-luna': { serviceTierMap: map },
          },
        }),
      },
    },
  } as unknown as ProviderConfig;
}

describe('resolveAliasServiceTiers', () => {
  it('unions native support across targets without adding fallback-only tiers', () => {
    const models = {
      custom: alias([
        { provider: 'plus', model: 'gpt-6-luna' },
        { provider: 'api', model: 'gpt-6-luna' },
        { provider: 'unknown', model: 'unknown' },
      ]),
    };
    const providers = {
      plus: provider({ priority: 'priority', standard: 'default', flex: null }),
      api: provider({ flex: 'flex', auto: 'auto', standard: 'default' }),
      unknown: provider(),
    };
    expect(resolveAliasServiceTiers('custom', models, providers)).toEqual([
      'auto',
      'standard',
      'flex',
      'priority',
    ]);
    expect(providers.plus.pi_ai_quirks?.responses?.models?.custom?.serviceTierMap?.flex).toBeNull();
  });

  it('expands nested and additional aliases, tolerates cycles and missing references', () => {
    const models = {
      root: alias([{ alias: 'alternate' }, { alias: 'missing' }]),
      child: {
        ...alias([{ alias: 'root' }, { provider: 'api', model: 'custom' }]),
        additional_aliases: ['alternate'],
      },
    };
    expect(
      resolveAliasServiceTiers('root', models, {
        api: provider({ flex: 'flex' }),
      })
    ).toEqual(['flex']);
  });

  it('ignores disabled targets, nested references and providers', () => {
    const models = {
      root: alias([
        { provider: 'api', model: 'custom', enabled: false },
        { alias: 'child', enabled: false },
        { provider: 'disabled', model: 'custom' },
        { provider: 'missing', model: 'custom' },
      ]),
      child: alias([{ provider: 'api', model: 'custom' }]),
    };
    expect(
      resolveAliasServiceTiers('root', models, {
        api: provider({ flex: 'flex' }),
        disabled: { ...provider({ priority: 'priority' }), enabled: false },
      })
    ).toBeUndefined();
  });

  it('requires auto-compat on either the provider or model', () => {
    const models = { root: alias([{ provider: 'api', model: 'custom' }]) };
    const api = provider({ flex: 'flex' });
    api.auto_compat = undefined;
    expect(resolveAliasServiceTiers('root', models, { api })).toBeUndefined();
    api.auto_compat = false;
    expect(resolveAliasServiceTiers('root', models, { api })).toBeUndefined();
    api.models = {
      custom: { auto_compat: true },
    } as unknown as ProviderConfig['models'];
    expect(resolveAliasServiceTiers('root', models, { api })).toEqual(['flex']);
    api.auto_compat = true;
    api.models = {
      custom: { auto_compat: false },
    } as unknown as ProviderConfig['models'];
    expect(resolveAliasServiceTiers('root', models, { api })).toEqual(['flex']);
  });

  it('distinguishes unknown capabilities from a known empty map', () => {
    const models = { root: alias([{ provider: 'api', model: 'custom' }]) };
    expect(resolveAliasServiceTiers('root', models, { api: provider() })).toBeUndefined();
    expect(
      resolveAliasServiceTiers('root', models, {
        api: provider({ flex: null }),
      })
    ).toEqual([]);
    expect(resolveAliasServiceTiers('root', models, { api: provider({}) })).toEqual([]);
  });

  it('uses model overrides as replacements and respects model API access', () => {
    const api = provider({ flex: 'flex', priority: 'priority' });
    api.api_base_url = {
      responses: 'https://example.test',
      chat: 'https://example.test',
    };
    api.models = {
      custom: { access_via: [{ type: 'responses', subtype: 'special' }] },
    } as unknown as ProviderConfig['models'];
    api.pi_ai_quirks!.responses!.models = {
      custom: { serviceTierMap: { standard: 'default' } },
    };
    api.pi_ai_quirks!.chat = {
      api: 'openai-completions',
      models: { custom: { serviceTierMap: { ultrafast: 'ultrafast' } } },
    };
    expect(
      resolveAliasServiceTiers(
        'root',
        { root: alias([{ provider: 'api', model: 'custom' }]) },
        { api }
      )
    ).toEqual(['standard']);
  });

  it('overlays quirks onto the target builtin, not the alias display identity', () => {
    const spy = registerSpy(registry, 'resolvePiAiModel').mockReturnValue({
      id: 'linked-model',
      api: 'openai-responses',
      serviceTierMap: { standard: 'default', flex: 'flex' },
    } as unknown as NonNullable<ReturnType<typeof registry.resolvePiAiModel>>);
    const api = provider({ priority: 'priority' });
    api.pi_ai_provider = 'openai';
    api.models = {
      custom: { pi_ai_model_id: 'linked-model' },
    } as unknown as ProviderConfig['models'];
    const models = {
      root: {
        ...alias([{ provider: 'api', model: 'custom' }]),
        pi_model: { provider: 'unrelated', model_id: 'unrelated' },
      },
    };
    expect(resolveAliasServiceTiers('root', models, { api })).toEqual(['priority']);
    expect(spy).toHaveBeenCalledWith('openai', 'linked-model');
    api.pi_ai_quirks = undefined;
    expect(resolveAliasServiceTiers('root', models, { api })).toEqual(['standard', 'flex']);
  });

  it('falls back to inline quirks for an unresolved explicit model link', () => {
    const spy = registerSpy(registry, 'resolvePiAiModel').mockReturnValue(null);
    const api = provider({ flex: 'flex' });
    api.pi_ai_provider = 'openai';
    api.models = {
      custom: { pi_ai_model_id: 'missing' },
    } as unknown as ProviderConfig['models'];
    expect(
      resolveAliasServiceTiers(
        'root',
        { root: alias([{ provider: 'api', model: 'custom' }]) },
        { api }
      )
    ).toEqual(['flex']);
    expect(spy).toHaveBeenCalledWith('openai', 'missing');
  });

  it('ignores provider-wide maps that no model declares', () => {
    const api = provider();
    api.pi_ai_quirks!.responses!.serviceTierMap = {
      flex: 'flex',
      priority: 'priority',
    };
    const models = { root: alias([{ provider: 'api', model: 'custom' }]) };
    expect(resolveAliasServiceTiers('root', models, { api })).toBeUndefined();
  });

  it('does not advertise OpenRouter tiers for arbitrary models', () => {
    const openrouter = presets.presets.find((preset) => preset.id === 'openrouter');
    const providers = {
      openrouter: {
        api_base_url: { chat: 'https://example.test' },
        auto_compat: openrouter!.autoCompat,
        pi_ai_quirks: openrouter!.piAiQuirks,
      },
    } as unknown as Record<string, ProviderConfig>;
    for (const model of ['anthropic/claude-sonnet-4', 'deepseek/deepseek-chat']) {
      expect(
        resolveAliasServiceTiers(
          'root',
          { root: alias([{ provider: 'openrouter', model }]) },
          providers
        )
      ).toBeUndefined();
    }
  });

  it('rejects unmappable formats and empty or unsupported speed spellings', () => {
    const api = provider({
      priority: 'fast',
      standard: 'standard',
      auto: 'auto',
      flex: '',
    });
    api.pi_ai_quirks!.responses!.compat = {
      serviceTierFormat: 'anthropic-speed',
    };
    const models = { root: alias([{ provider: 'api', model: 'custom' }]) };
    expect(resolveAliasServiceTiers('root', models, { api })).toBeUndefined();
    const map = api.pi_ai_quirks!.responses!.models!.custom!.serviceTierMap;
    api.api_base_url = { messages: 'https://example.test' };
    api.pi_ai_quirks = {
      messages: {
        api: 'anthropic-messages',
        models: { custom: { serviceTierMap: map } },
      },
    };
    expect(resolveAliasServiceTiers('root', models, { api })).toEqual(['standard', 'priority']);
    api.api_base_url = { gemini: 'https://example.test' };
    api.pi_ai_quirks = {
      gemini: {
        api: 'google-generative-ai',
        models: { custom: { serviceTierMap: map } },
      },
    };
    expect(resolveAliasServiceTiers('root', models, { api })).toBeUndefined();
  });

  it('publishes the verified Sonnet, Opus and GPT-6 preset capabilities', () => {
    const openai = presets.presets.find((preset) => preset.id === 'openai');
    const anthropic = presets.presets.find((preset) => preset.id === 'anthropic');
    expect(openai).toBeDefined();
    expect(anthropic).toBeDefined();
    const providers = {
      openai: {
        api_base_url: { responses: 'https://example.test' },
        auto_compat: openai!.autoCompat,
        pi_ai_quirks: openai!.piAiQuirks,
      },
      anthropic: {
        api_base_url: { messages: 'https://example.test' },
        auto_compat: anthropic!.autoCompat,
        pi_ai_quirks: anthropic!.piAiQuirks,
      },
    } as unknown as Record<string, ProviderConfig>;
    for (const model of ['gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol']) {
      expect(
        resolveAliasServiceTiers(
          'custom',
          { custom: alias([{ provider: 'openai', model }]) },
          providers
        )
      ).toEqual([
        'auto',
        'standard',
        'flex',
        'priority',
        ...(model === 'gpt-6-astra' ? ['ultrafast'] : []),
      ]);
    }
    expect(
      resolveAliasServiceTiers(
        'custom',
        {
          custom: alias([{ provider: 'anthropic', model: 'claude-opus-5-5' }]),
        },
        providers
      )
    ).toEqual(['priority']);
    expect(
      resolveAliasServiceTiers(
        'custom',
        {
          custom: alias([{ provider: 'anthropic', model: 'claude-sonnet-5-5' }]),
        },
        providers
      )
    ).toBeUndefined();
  });
});
