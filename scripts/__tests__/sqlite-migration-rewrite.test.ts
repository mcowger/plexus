import { describe, expect, it } from 'vitest';
import {
  extractRecreationInserts,
  rewriteTableRecreationInserts,
  validateTableRecreationInserts,
  snapshotTableColumns,
  type Snapshot,
} from '../lib/sqlite-migration-rewrite';

/**
 * Builds a minimal snapshot where only one table's column set matters for tests.
 */
function snapshot(table: string, columns: string[]): Snapshot {
  const cols: Record<string, unknown> = {};
  for (const c of columns) cols[c] = {};
  return { tables: { [table]: { columns: cols } } };
}

// The canonical offending statement (identical in shape to the generated
// alias-as-fallback-target migration that corrupted production data):
// `target_alias_slug` is new to the source table, so the bare double-quoted
// reference is a dangling identifier that SQLite DQS silently treats as a
// string literal.
const OFFENDING_SQL =
  'INSERT INTO `__new_model_alias_targets`("id", "alias_id", "provider_slug", "model_name", "target_alias_slug", "enabled", "group_name", "sort_order") ' +
  'SELECT "id", "alias_id", "provider_slug", "model_name", "target_alias_slug", "enabled", "group_name", "sort_order" FROM `model_alias_targets`;';

const LEGACY_COLS = [
  'id',
  'alias_id',
  'provider_slug',
  'model_name',
  'enabled',
  'group_name',
  'sort_order',
];

describe('extractRecreationInserts', () => {
  it('extracts a table-recreation INSERT with its column lists', () => {
    const inserts = extractRecreationInserts(OFFENDING_SQL);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.sourceTable).toBe('model_alias_targets');
    expect(inserts[0]!.insertColumns).toContain('target_alias_slug');
    expect(inserts[0]!.selectTerms.map((t) => t.identifier)).toContain('target_alias_slug');
  });

  it('returns nothing for a plain CREATE TABLE with no recreation', () => {
    const sql = 'CREATE TABLE `foo`("a", "b"); INSERT INTO `foo`("a","b") VALUES (1,2);';
    expect(extractRecreationInserts(sql)).toHaveLength(0);
  });

  it('returns nothing when dest and source table names disagree', () => {
    // A shape we don't model; must skip rather than mis-rewrite.
    const sql = 'INSERT INTO `__new_bar`("a") SELECT "a" FROM `baz`;';
    expect(extractRecreationInserts(sql)).toHaveLength(0);
  });
});

describe('snapshotTableColumns', () => {
  it('reads column names from a snapshot table', () => {
    const cols = snapshotTableColumns(snapshot('t', ['a', 'b']), 't');
    expect(cols).toEqual(new Set(['a', 'b']));
  });

  it('returns empty set for a missing snapshot or table', () => {
    expect(snapshotTableColumns(null, 't').size).toBe(0);
    expect(snapshotTableColumns(snapshot('t', ['a']), 'other').size).toBe(0);
  });
});

describe('rewriteTableRecreationInserts', () => {
  it('replaces source-absent columns with NULL (the production fix)', () => {
    const prev = snapshot('model_alias_targets', LEGACY_COLS);
    const out = rewriteTableRecreationInserts(OFFENDING_SQL, prev);
    expect(out).toContain(
      'SELECT "id", "alias_id", "provider_slug", "model_name", NULL, "enabled", "group_name", "sort_order" FROM `model_alias_targets`'
    );
    // The INSERT column list is preserved verbatim.
    expect(out).toContain(
      '`__new_model_alias_targets`("id", "alias_id", "provider_slug", "model_name", "target_alias_slug", "enabled", "group_name", "sort_order")'
    );
  });

  it('does not touch columns that exist in the source', () => {
    const prev = snapshot('model_alias_targets', LEGACY_COLS);
    const out = rewriteTableRecreationInserts(OFFENDING_SQL, prev);
    // All legacy columns keep their double-quoted form.
    for (const c of LEGACY_COLS) {
      expect(out).toContain(`"${c}"`);
    }
  });

  it('is a no-op when there is nothing to rewrite (pure constraint change)', () => {
    // A recreation that only changes a PK: every SELECT column exists.
    const safeSql =
      'INSERT INTO `__new_quota_state`("key_name", "quota_name") SELECT "key_name", "quota_name" FROM `quota_state`;';
    const prev = snapshot('quota_state', ['key_name', 'quota_name']);
    expect(rewriteTableRecreationInserts(safeSql, prev)).toBe(safeSql);
  });

  it('preserves multiple table recreations and rewrites only the offending one', () => {
    const prev = {
      tables: {
        quota_state: { columns: { key_name: {}, quota_name: {}, window_start: {} } },
        model_alias_targets: {
          columns: Object.fromEntries(LEGACY_COLS.map((c) => [c, {}])),
        },
      },
    };
    const sql =
      'INSERT INTO `__new_quota_state`("key_name", "quota_name", "window_start") SELECT "key_name", "quota_name", "window_start" FROM `quota_state`;\n' +
      OFFENDING_SQL;
    const out = rewriteTableRecreationInserts(sql, prev as Snapshot);
    // First statement untouched.
    expect(out).toContain('SELECT "key_name", "quota_name", "window_start" FROM `quota_state`');
    // Second statement rewritten.
    expect(out).toContain(
      'SELECT "id", "alias_id", "provider_slug", "model_name", NULL, "enabled", "group_name", "sort_order" FROM `model_alias_targets`'
    );
  });

  it('treats a NULL/e expression SELECT term as already-safe (no rewrite)', () => {
    const prev = snapshot('t', ['a']);
    const sql = 'INSERT INTO `__new_t`("a", "b") SELECT "a", NULL FROM `t`;';
    const out = rewriteTableRecreationInserts(sql, prev);
    expect(out).toBe(sql);
  });

  it('is a no-op when no previous snapshot is available', () => {
    expect(rewriteTableRecreationInserts(OFFENDING_SQL, null)).toBe(OFFENDING_SQL);
  });

  it('throws on INSERT/SELECT arity mismatch', () => {
    const prev = snapshot('t', ['a', 'b']);
    const sql = 'INSERT INTO `__new_t`("a", "b", "c") SELECT "a", "b" FROM `t`;';
    expect(() => rewriteTableRecreationInserts(sql, prev)).toThrow(/columns but SELECT has/);
  });
});

describe('validateTableRecreationInserts', () => {
  it('flags an offending statement before rewrite', () => {
    const prev = snapshot('model_alias_targets', LEGACY_COLS);
    const offenses = validateTableRecreationInserts(OFFENDING_SQL, '0061_x.sql', prev);
    expect(offenses).toHaveLength(1);
    expect(offenses[0]!.sourceTable).toBe('model_alias_targets');
    expect(offenses[0]!.absentColumns).toEqual(['target_alias_slug']);
  });

  it('passes a correctly-rewritten statement', () => {
    const prev = snapshot('model_alias_targets', LEGACY_COLS);
    const rewritten = rewriteTableRecreationInserts(OFFENDING_SQL, prev);
    expect(validateTableRecreationInserts(rewritten, '0061_x.sql', prev)).toEqual([]);
  });

  it('skips validation when the source snapshot is unavailable', () => {
    // No snapshot -> can't know -> don't fail (first migration case).
    expect(validateTableRecreationInserts(OFFENDING_SQL, 'x.sql', null)).toEqual([]);
  });
});
