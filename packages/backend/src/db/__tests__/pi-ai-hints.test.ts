import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { ProviderConfig } from '../../config';

describe('pi_ai_provider and pi_ai_model_id persistence', () => {
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
      estimateTokens: false,
      useClaudeMasking: false,
      pi_ai_provider: 'anthropic',
      models: {
        'claude-opus-4-6': {
          pricing: { source: 'simple', input: 3.0, output: 15.0 },
          pi_ai_model_id: 'claude-opus-4-6',
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
    expect(loaded?.pi_ai_provider).toBe('anthropic');

    const models = loaded?.models as Record<string, any>;
    expect(models?.['claude-opus-4-6']?.pi_ai_model_id).toBe('claude-opus-4-6');
    // Model without pi_ai_model_id should not have the field
    expect(models?.['claude-sonnet-4']?.pi_ai_model_id).toBeUndefined();
  });

  it('round-trips null pi_ai_provider as undefined (not present)', async () => {
    const provider: ProviderConfig = {
      api_base_url: 'https://api.example.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
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

  it('overwrites pi_ai_provider and pi_ai_model_id on update', async () => {
    const initial: ProviderConfig = {
      api_base_url: 'https://api.anthropic.com/v1',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
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
