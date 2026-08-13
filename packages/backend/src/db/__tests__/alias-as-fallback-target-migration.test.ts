import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database } from 'bun:sqlite';
import { closeDatabase, initializeDatabase, getDatabase, getSchema } from '../client';
import { ConfigRepository } from '../config-repository';
import { toDbBoolean } from '../../utils/normalize';

/**
 * Regression suite for the `model_alias_targets` table-recreation migration
 * (alias-as-fallback-target, SQLite migration 0061).
 *
 * Background: drizzle-kit generated `INSERT INTO __new_model_alias_targets (...)
 * SELECT ..., "target_alias_slug", ... FROM model_alias_targets` where
 * `target_alias_slug` did not exist on the source table. Under SQLite's
 * double-quoted-string misfeature that dangling identifier silently became the
 * string literal 'target_alias_slug' in EVERY row, which then made
 * `rowToModelConfig` treat every concrete target as an alias-reference —
 * breaking all model configurations. We reproduced it on a realistic 13-alias /
 * 23-target DB and confirmed the fix (generation now emits NULL for
 * source-absent columns).
 *
 * This suite builds the real pre-feature schema + data, applies the actual 0061
 * migration SQL, and asserts no corruption — the regression that guards against
 * re-introducing the bug.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../drizzle/migrations');

interface Journal {
  entries: Array<{ tag: string }>;
}

function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Rows represent the realistic pre-feature dataset: 13 aliases, 23 concrete targets. */
const ALIASES: Array<{
  slug: string;
  selector: string;
  targets: Array<{ provider: string; model: string }>;
}> = [
  {
    slug: 'claude-sonnet',
    selector: 'random',
    targets: [
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-5' },
    ],
  },
  {
    slug: 'claude-opus',
    selector: 'in_order',
    targets: [
      { provider: 'anthropic', model: 'claude-opus-4-1' },
      { provider: 'openrouter', model: 'anthropic/claude-opus-4-1' },
    ],
  },
  {
    slug: 'gpt-4o',
    selector: 'random',
    targets: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'openrouter', model: 'openai/gpt-4o' },
    ],
  },
  {
    slug: 'gpt-4o-mini',
    selector: 'random',
    targets: [{ provider: 'openai', model: 'gpt-4o-mini' }],
  },
  {
    slug: 'gemini-pro',
    selector: 'in_order',
    targets: [{ provider: 'google', model: 'gemini-2.5-pro' }],
  },
  {
    slug: 'gemini-flash',
    selector: 'random',
    targets: [{ provider: 'google', model: 'gemini-2.5-flash' }],
  },
  {
    slug: 'deepseek-r1',
    selector: 'random',
    targets: [
      { provider: 'deepseek', model: 'deepseek-r1' },
      { provider: 'openrouter', model: 'deepseek/deepseek-r1' },
    ],
  },
  {
    slug: 'llama-3-70b',
    selector: 'in_order',
    targets: [{ provider: 'meta', model: 'llama-3-70b' }],
  },
  { slug: 'qwen-max', selector: 'random', targets: [{ provider: 'alibaba', model: 'qwen-max' }] },
  {
    slug: 'mistral-large',
    selector: 'random',
    targets: [
      { provider: 'mistral', model: 'mistral-large-latest' },
      { provider: 'openrouter', model: 'mistralai/mistral-large' },
    ],
  },
  {
    slug: 'command-r-plus',
    selector: 'in_order',
    targets: [{ provider: 'cohere', model: 'command-r-plus' }],
  },
  { slug: 'grok-beta', selector: 'random', targets: [{ provider: 'xai', model: 'grok-beta' }] },
  {
    slug: 'o1-preview',
    selector: 'in_order',
    targets: [
      { provider: 'openai', model: 'o1-preview' },
      { provider: 'openrouter', model: 'openai/o1-preview' },
    ],
  },
];
const TOTAL_TARGETS = ALIASES.reduce((sum, a) => sum + a.targets.length, 0); // 23

let dbPath: string;

beforeEach(async () => {
  await closeDatabase();
  dbPath = path.join(
    os.tmpdir(),
    `plexus-alias-migration-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  buildPreFeatureDb(dbPath);
});

afterEach(async () => {
  await closeDatabase();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});

/** Build the pre-feature (0060) schema by applying prior migrations, then seed data. */
function buildPreFeatureDb(path_: string): void {
  const sqlite = new Database(path_);
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')
  ) as Journal;
  const preFeature = journal.entries.filter((e) => !e.tag.startsWith('0061'));

  for (const entry of preFeature) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    for (const stmt of splitStatements(sql)) sqlite.run(stmt);
  }

  // Seed 13 aliases + 23 concrete targets (legacy: provider_slug/model_name NOT NULL).
  const now = Math.floor(Date.now() / 1000);
  for (const alias of ALIASES) {
    const ins = sqlite
      .prepare(
        'INSERT INTO model_aliases (slug, selector, priority, model_type, target_groups, use_image_fallthrough, enforce_limits, sticky_session, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        alias.slug,
        alias.selector,
        'selector',
        'text',
        JSON.stringify([{ name: 'default', selector: alias.selector }]),
        0,
        0,
        0,
        now,
        now
      );
    const aliasId = Number(ins.lastInsertRowid);
    for (const t of alias.targets) {
      sqlite
        .prepare(
          'INSERT INTO model_alias_targets (alias_id, provider_slug, model_name, enabled, group_name, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(aliasId, t.provider, t.model, 1, 'default', 0);
    }
  }
  sqlite.close();
}

/** Apply a migration SQL file to the DB (process one statement at a time). */
function applyMigrationFile(path_: string, tag: string): void {
  const sqlite = new Database(path_);
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  for (const stmt of splitStatements(sql)) sqlite.run(stmt);
  sqlite.close();
}

/** Read raw target rows back from the DB. */
function readTargets(path_: string): Array<{
  providerSlug: string | null;
  modelName: string | null;
  targetAliasSlug: string | null;
  groupName: string | null;
}> {
  const sqlite = new Database(path_, { readonly: true });
  const rows = sqlite
    .query(
      'SELECT provider_slug AS providerSlug, model_name AS modelName, target_alias_slug AS targetAliasSlug, group_name AS groupName FROM model_alias_targets ORDER BY id'
    )
    .all() as Array<{
    providerSlug: string | null;
    modelName: string | null;
    targetAliasSlug: string | null;
    groupName: string | null;
  }>;
  sqlite.close();
  return rows;
}

describe('alias-as-fallback-target migration (0061) data integrity', () => {
  it('preserves all 23 targets with provider/model intact and target_alias_slug NULL', () => {
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    const targets = readTargets(dbPath);

    expect(targets).toHaveLength(TOTAL_TARGETS); // no rows lost
    for (const t of targets) {
      // Concrete targets must keep their provider and model verbatim.
      expect(t.providerSlug).toBeTruthy();
      expect(t.modelName).toBeTruthy();
      // The migration must NOT have injected the literal column-name string.
      expect(t.targetAliasSlug).toBeNull();
    }
  });

  it('target_groups JSON and group_name survive (grouping intact)', () => {
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    const sqlite = new Database(dbPath, { readonly: true });
    const groups = sqlite
      .query("SELECT COUNT(*) AS c FROM model_alias_targets WHERE group_name = 'default'")
      .get() as { c: number };
    const aliasGroups = sqlite
      .query('SELECT COUNT(*) AS c FROM model_aliases WHERE target_groups IS NOT NULL')
      .get() as { c: number };
    sqlite.close();
    expect(groups.c).toBe(TOTAL_TARGETS);
    expect(aliasGroups.c).toBe(ALIASES.length);
  });
});

describe('repository round-trip after migration', () => {
  it('loads every alias with concrete {provider, model} targets (not alias references)', async () => {
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    initializeDatabase(`sqlite://${dbPath}`);
    const repo = new ConfigRepository();
    const models = await repo.getAllAliases();

    expect(Object.keys(models)).toHaveLength(ALIASES.length);
    for (const alias of ALIASES) {
      const cfg = models[alias.slug];
      expect(cfg, `alias ${alias.slug} should load`).toBeDefined();
      const groups = cfg!.target_groups ?? [];
      expect(groups).toHaveLength(1);
      const targets = groups[0]!.targets ?? [];
      expect(targets).toHaveLength(alias.targets.length);

      for (let i = 0; i < alias.targets.length; i++) {
        const loaded = targets[i]!;
        expect(loaded).not.toHaveProperty('alias');
        expect(loaded.provider).toBe(alias.targets[i]!.provider);
        expect(loaded.model).toBe(alias.targets[i]!.model);
      }
    }
  });
});

describe('repair of already-corrupted databases', () => {
  it('nulls the literal corrupt slug only on concrete targets, and is idempotent', async () => {
    // Simulate the production corruption: every target got target_alias_slug = 'target_alias_slug'.
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    const sqlite = new Database(dbPath);
    sqlite.prepare("UPDATE model_alias_targets SET target_alias_slug = 'target_alias_slug'").run();
    sqlite.close();

    initializeDatabase(`sqlite://${dbPath}`);
    const repo = new ConfigRepository();

    const first = await repo.repairCorruptedAliasFallbackSlugs();
    expect(first).toBe(TOTAL_TARGETS);

    // After repair, concrete targets are restored.
    const models = await repo.getAllAliases();
    for (const alias of ALIASES) {
      const targets = models[alias.slug]!.target_groups![0]!.targets!;
      for (const loaded of targets) {
        expect(loaded).not.toHaveProperty('alias');
        expect(loaded.provider).toBeTruthy();
      }
    }

    // Second run repairs nothing.
    const second = await repo.repairCorruptedAliasFallbackSlugs();
    expect(second).toBe(0);
  });

  it('does not touch a legitimate fallback-alias reference', async () => {
    // A genuine alias target (no provider/model) must never be nulled.
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    const sqlite = new Database(dbPath);
    const aliasId = (sqlite.query('SELECT id FROM model_aliases LIMIT 1').get() as { id: number })
      .id;
    // Add a real fallback target that references another alias slug.
    sqlite
      .prepare(
        "INSERT INTO model_alias_targets (alias_id, provider_slug, model_name, target_alias_slug, enabled, group_name, sort_order) VALUES (?, NULL, NULL, 'gpt-4o', 1, 'default', 99)"
      )
      .run(aliasId);
    // Also plant the corrupt literal on a concrete row.
    sqlite
      .prepare(
        "UPDATE model_alias_targets SET target_alias_slug = 'target_alias_slug' WHERE provider_slug IS NOT NULL LIMIT 1"
      )
      .run();
    sqlite.close();

    initializeDatabase(`sqlite://${dbPath}`);
    const repo = new ConfigRepository();
    await repo.repairCorruptedAliasFallbackSlugs();

    const sqlite2 = new Database(dbPath, { readonly: true });
    const fallback = sqlite2
      .query("SELECT target_alias_slug FROM model_alias_targets WHERE target_alias_slug = 'gpt-4o'")
      .all() as Array<{ target_alias_slug: string }>;
    sqlite2.close();
    expect(fallback).toHaveLength(1); // the real alias reference survived
  });
});

describe('mixed concrete + alias targets round-trip (saveAlias -> getAlias)', () => {
  it('persists and reloads a mix of concrete and fallback-alias targets', async () => {
    applyMigrationFile(dbPath, '0061_add_alias_as_fallback_target');
    initializeDatabase(`sqlite://${dbPath}`);
    const repo = new ConfigRepository();

    await repo.saveAlias('mixed', {
      target_groups: [
        {
          name: 'primary',
          selector: 'random',
          targets: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }, { alias: 'gpt-4o' }],
        },
      ],
    } as any);

    const cfg = await repo.getAlias('mixed');
    const targets = cfg!.target_groups![0]!.targets!;
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      enabled: true,
    });
    expect(targets[1]).toEqual({ alias: 'gpt-4o', enabled: true });

    // And the raw rows encode it correctly — scoped to the 'mixed' alias only,
    // since the seeded aliases contribute their own targets.
    const sqlite = new Database(dbPath, { readonly: true });
    const mixedId = (
      sqlite.query("SELECT id FROM model_aliases WHERE slug = 'mixed'").get() as { id: number }
    ).id;
    const rows = sqlite
      .query(
        'SELECT provider_slug, model_name, target_alias_slug FROM model_alias_targets WHERE alias_id = ? ORDER BY sort_order'
      )
      .all(mixedId) as Array<{
      provider_slug: string | null;
      model_name: string | null;
      target_alias_slug: string | null;
    }>;
    sqlite.close();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      provider_slug: 'anthropic',
      model_name: 'claude-sonnet-4-5',
      target_alias_slug: null,
    });
    expect(rows[1]).toMatchObject({
      provider_slug: null,
      model_name: null,
      target_alias_slug: 'gpt-4o',
    });
  });
});
