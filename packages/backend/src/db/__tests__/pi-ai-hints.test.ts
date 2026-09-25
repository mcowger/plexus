import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import { ProviderConfigSchema, type ProviderConfig } from '../../config';

describe('pi-ai quirk source persistence', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();

    repo = new ConfigRepository();
    await repo.clearAllData();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('round-trips pi_ai_provider on a provider and pi_ai_model_id on each model', async () => {
    const provider: ProviderConfig = {
      api_base_url: 'https://api.anthropic.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
      estimateTokens: false,
      useClaudeMasking: false,
      auto_compat: true,
      pi_ai_provider: 'anthropic',
      models: {
        'claude-opus-4-6': {
          pricing: { source: 'simple', input: 3.0, output: 15.0 },
          pi_ai_model_id: 'claude-opus-4-6',
          auto_compat: true,
        },
        'claude-sonnet-4': {
          pricing: { source: 'simple', input: 1.0, output: 5.0 },
          // intentionally no pi_ai_model_id on this model
        },
      },
    };

    await repo.saveProvider('pi-ai-test', provider);

    const loaded = await repo.getProvider('pi-ai-test');

    expect(loaded).not.toBeNull();
    expect(loaded?.auto_compat).toBe(true);
    expect(loaded?.pi_ai_provider).toBe('anthropic');

    const models = loaded?.models as Record<string, any>;
    expect(models?.['claude-opus-4-6']?.pi_ai_model_id).toBe('claude-opus-4-6');
    expect(models?.['claude-opus-4-6']?.auto_compat).toBe(true);
    // Model without pi_ai_model_id should not have the field
    expect(models?.['claude-sonnet-4']?.pi_ai_model_id).toBeUndefined();
  });

  it('round-trips null pi_ai_provider as undefined (not present)', async () => {
    const provider: ProviderConfig = {
      api_base_url: 'https://api.example.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
      estimateTokens: false,
      useClaudeMasking: false,
      // no pi_ai_provider
      models: {
        'gpt-4': { pricing: { source: 'simple', input: 0, output: 0 } },
      },
    };

    await repo.saveProvider('no-pi-ai', provider);
    const loaded = await repo.getProvider('no-pi-ai');

    expect(loaded?.pi_ai_provider).toBeUndefined();
    const models = loaded?.models as Record<string, any>;
    expect(models?.['gpt-4']?.pi_ai_model_id).toBeUndefined();
  });

  it('round-trips inline target and exact-model overrides independently of the builtin source', async () => {
    const quirks = {
      chat: {
        api: 'openai-completions' as const,
        compat: { maxTokensField: 'max_completion_tokens' as const },
        models: {
          'upstream/special': { maxTokens: 64, compat: { supportsTemperature: false } },
        },
      },
      responses: { api: 'openai-responses' as const, maxTokens: 128 },
    };
    const provider = ProviderConfigSchema.parse({
      api_base_url: {
        chat: 'https://api.example.com/v1',
        responses: 'https://api.example.com/v1',
      },
      api_key: 'sk-test',
      auto_compat: true,
      pi_ai_quirks: quirks,
      models: { 'upstream/special': { pricing: { source: 'simple', input: 0, output: 0 } } },
    });

    await repo.saveProvider('inline-test', provider);
    const loaded = await repo.getProvider('inline-test');
    expect(loaded?.pi_ai_quirks).toEqual(quirks);
    expect(loaded?.pi_ai_provider).toBeUndefined();
    expect(loaded?.auto_compat).toBe(true);

    // A complete replacement must clear the previous quirk source, including its model map.
    await repo.saveProvider('inline-test', {
      ...provider,
      pi_ai_quirks: undefined,
      pi_ai_provider: 'openai',
    });
    const builtin = await repo.getProvider('inline-test');
    expect(builtin?.pi_ai_quirks).toBeUndefined();
    expect(builtin?.pi_ai_provider).toBe('openai');
  });

  it('overwrites pi_ai_provider and pi_ai_model_id on update', async () => {
    const initial: ProviderConfig = {
      api_base_url: 'https://api.anthropic.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
      estimateTokens: false,
      useClaudeMasking: false,
      pi_ai_provider: 'anthropic',
      models: {
        'claude-opus-4-6': {
          pricing: { source: 'simple', input: 3, output: 15 },
          pi_ai_model_id: 'claude-opus-4-6',
        },
      },
    };

    await repo.saveProvider('overwrite-test', initial);

    // Now update without pi_ai fields — they should disappear
    const updated: ProviderConfig = {
      api_base_url: 'https://api.anthropic.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      allow_100_percent_utilization: false,
      estimateTokens: false,
      useClaudeMasking: false,
      // pi_ai_provider omitted
      models: {
        'claude-opus-4-6': {
          pricing: { source: 'simple', input: 3, output: 15 },
          // pi_ai_model_id omitted
        },
      },
    };

    await repo.saveProvider('overwrite-test', updated);

    const loaded = await repo.getProvider('overwrite-test');
    expect(loaded?.pi_ai_provider).toBeUndefined();
    const models = loaded?.models as Record<string, any>;
    expect(models?.['claude-opus-4-6']?.pi_ai_model_id).toBeUndefined();
  });
});
