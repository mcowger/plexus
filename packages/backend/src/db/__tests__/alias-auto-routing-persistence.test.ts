import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getCurrentDialect, getDatabase, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';

/**
 * The auto_routing / auto_profile columns are defined in the Drizzle schema but
 * the committed migrations predate them (CI generates migrations after merge).
 * Mirror target-groups-migration.test.ts and add them locally so the round-trip
 * runs against both dialects; the ALTER is a no-op once a migration exists.
 */
async function ensureAutoRoutingColumns(): Promise<void> {
  const db = getDatabase();
  const dialect = getCurrentDialect();
  const statements =
    dialect === 'postgres'
      ? [
          'ALTER TABLE model_aliases ADD COLUMN auto_routing jsonb',
          'ALTER TABLE model_alias_targets ADD COLUMN auto_profile jsonb',
        ]
      : [
          'ALTER TABLE model_aliases ADD COLUMN auto_routing text',
          'ALTER TABLE model_alias_targets ADD COLUMN auto_profile text',
        ];
  for (const statement of statements) {
    try {
      await db.run(statement as never);
    } catch {
      // Column already exists — fine.
    }
  }
}

describe('alias auto routing persistence', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    await ensureAutoRoutingColumns();
    repo = new ConfigRepository();
    await repo.clearAllData();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('round-trips alias policy and concrete/alias target profiles', async () => {
    await repo.saveAlias('magic-model', {
      type: 'text',
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            {
              provider: 'provider-a',
              model: 'fast-model',
              auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
            },
            {
              alias: 'premium-models',
              auto_profile: {
                capability: 'premium',
                specialties: ['plan', 'review'],
                reasoning: 'preferred',
              },
            },
          ],
        },
      ],
      auto_routing: {
        mode: 'active',
        classifier_alias: 'routing-judge',
        classifier_deadline_ms: 500,
        rubric_version: 1,
        baseline_policy: 'cost',
        uncertainty_minimum_tier: 'high',
        scoring: {
          complexity_weight: 0.55,
          capability_weight: 0.45,
          reasoning_threshold: 0.65,
          reasoning_boost: 0.5,
          confidence_threshold: 0.6,
          tier_boundaries: { standard: 0.75, high: 1.75, premium: 2.5 },
          task_minimum_tiers: { plan: 'high', review: 'high' },
        },
        preferences: { specialty_bonus: 0.1, reasoning_bonus: 0.1 },
        switching: {
          score_deadband: 0.2,
          minimum_savings_usd: 0.01,
          minimum_savings_fraction: 0.1,
          preference_margin: 0.05,
        },
      },
    } as never);

    const loaded = await repo.getAlias('magic-model');
    expect(loaded?.auto_routing).toMatchObject({
      mode: 'active',
      classifier_alias: 'routing-judge',
      baseline_policy: 'cost',
      uncertainty_minimum_tier: 'high',
    });
    expect(loaded?.auto_routing?.scoring.tier_boundaries).toEqual({
      standard: 0.75,
      high: 1.75,
      premium: 2.5,
    });

    const group = loaded?.target_groups?.[0];
    expect(group?.selector).toBe('auto');
    expect(group?.targets[0]).toMatchObject({
      provider: 'provider-a',
      model: 'fast-model',
      auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
    });
    expect(group?.targets[1]).toMatchObject({
      alias: 'premium-models',
      auto_profile: {
        capability: 'premium',
        specialties: ['plan', 'review'],
        reasoning: 'preferred',
      },
    });
  });

  it('leaves auto fields null for aliases that do not use auto', async () => {
    await repo.saveAlias('plain-alias', {
      target_groups: [
        { name: 'default', selector: 'in_order', targets: [{ provider: 'p', model: 'm' }] },
      ],
    } as never);

    const loaded = await repo.getAlias('plain-alias');
    expect(loaded?.auto_routing).toBeUndefined();
    expect(loaded?.target_groups?.[0]?.targets[0]?.auto_profile).toBeUndefined();
  });

  it('preserves policy across unrelated alias writes', async () => {
    await repo.saveAlias('magic-model', {
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            {
              provider: 'provider-a',
              model: 'fast-model',
              auto_profile: { capability: 'high', specialties: [], reasoning: 'preferred' },
            },
          ],
        },
      ],
      auto_routing: { mode: 'off', classifier_alias: '', classifier_deadline_ms: 500 },
    } as never);

    await repo.saveAlias('unrelated', {
      target_groups: [
        { name: 'default', selector: 'random', targets: [{ provider: 'p', model: 'm' }] },
      ],
    } as never);

    const loaded = await repo.getAlias('magic-model');
    expect(loaded?.auto_routing).toMatchObject({ mode: 'off', classifier_deadline_ms: 500 });
    expect(loaded?.target_groups?.[0]?.targets[0]?.auto_profile).toEqual({
      capability: 'high',
      specialties: [],
      reasoning: 'preferred',
    });
  });
});
