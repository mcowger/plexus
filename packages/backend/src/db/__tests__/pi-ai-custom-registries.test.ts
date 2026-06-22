import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { PiAiCustomProvider, PiAiCustomModel } from '../../config';

describe('pi-ai custom registries persistence (inference-v2)', () => {
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

  it('round-trips a custom provider', async () => {
    const def: PiAiCustomProvider = {
      api: 'openai-completions',
      display_name: 'Niche Host',
      compat: { maxTokensField: 'max_tokens', supportsReasoningEffort: false },
    };
    await repo.savePiAiCustomProvider('niche-host', def);
    const all = await repo.getAllPiAiCustomProviders();
    expect(all['niche-host']).toEqual(def);
  });

  it('round-trips an inherited custom model', async () => {
    const def: PiAiCustomModel = {
      inherits: { provider: 'openai', model_id: 'gpt-5.5' },
      contextWindow: 500000,
      maxTokens: 200000,
      compat: { supportsReasoningEffort: true },
    };
    await repo.savePiAiCustomModel('gpt-5.6', def);
    const all = await repo.getAllPiAiCustomModels();
    expect(all['gpt-5.6']).toEqual(def);
  });

  it('round-trips a standalone custom model', async () => {
    const def: PiAiCustomModel = {
      api: 'openai-completions',
      contextWindow: 32000,
      maxTokens: 8192,
      reasoning: false,
      thinkingLevelMap: { off: null, low: 'LOW' },
      cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
    };
    await repo.savePiAiCustomModel('fully-custom', def);
    const all = await repo.getAllPiAiCustomModels();
    expect(all['fully-custom']).toEqual(def);
  });

  it('updates and deletes registry entries', async () => {
    await repo.savePiAiCustomProvider('p', { api: 'anthropic-messages' });
    await repo.savePiAiCustomProvider('p', { api: 'openai-completions' });
    let providers = await repo.getAllPiAiCustomProviders();
    expect(providers['p']?.api).toBe('openai-completions');

    await repo.deletePiAiCustomProvider('p');
    providers = await repo.getAllPiAiCustomProviders();
    expect(providers['p']).toBeUndefined();
  });
});
