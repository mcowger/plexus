import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import type { KeyConfig, ModelConfig } from '../../config';

describe('generation policy persistence (inference-v2 Layer 4)', () => {
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

  it('round-trips a generation policy on an alias', async () => {
    const alias: ModelConfig = {
      priority: 'selector',
      sticky_session: true,
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
      generation: {
        reasoning: { default: 'medium', ceiling: 'high', allowClientOverride: true },
        maxTokens: { default: 4096, ceiling: 32000 },
        verbosity: { default: 'low' },
        serviceTier: { default: 'flex' },
      },
    } as any;

    await repo.saveAlias('reason-alias', alias);
    const loaded = await repo.getAlias('reason-alias');

    expect(loaded?.generation).toEqual({
      reasoning: { default: 'medium', ceiling: 'high', allowClientOverride: true },
      maxTokens: { default: 4096, ceiling: 32000 },
      verbosity: { default: 'low' },
      serviceTier: { default: 'flex' },
    });
  });

  it('omits generation when not set on an alias', async () => {
    const alias: ModelConfig = {
      priority: 'selector',
      sticky_session: true,
      target_groups: [{ name: 'default', selector: 'random', targets: [] }],
    } as any;

    await repo.saveAlias('plain-alias', alias);
    const loaded = await repo.getAlias('plain-alias');
    expect(loaded?.generation).toBeUndefined();
  });

  it('round-trips a generation policy on a key', async () => {
    const key: KeyConfig = {
      secret: 'sk-reason-test',
      generation: { reasoning: { floor: 'low', allowClientOverride: false } },
    } as any;

    await repo.saveKey('reason-key', key);
    const all = await repo.getAllKeys();

    expect(all['reason-key']?.generation).toEqual({
      reasoning: { floor: 'low', allowClientOverride: false },
    });
  });

  it('clears the generation policy on update when omitted', async () => {
    const initial: KeyConfig = {
      secret: 'sk-update-test',
      generation: { reasoning: { default: 'high' } },
    } as any;
    await repo.saveKey('update-key', initial);

    const updated: KeyConfig = { secret: 'sk-update-test' } as any;
    await repo.saveKey('update-key', updated);

    const all = await repo.getAllKeys();
    expect(all['update-key']?.generation).toBeUndefined();
  });
});
