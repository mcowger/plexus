import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SQLite table-recreation migration rewrite + validation.
 *
 * Background
 * ----------
 * drizzle-kit generates SQLite schema changes that can't be expressed as a
 * single `ALTER TABLE` (e.g. dropping NOT NULL, changing a PK) as a full
 * table recreation:
 *
 *   CREATE TABLE `__new_<t>` (...);
 *   INSERT INTO `__new_<t>`("c1", "c2", ..., "cN")
 *     SELECT "c1", "c2", ..., "cN" FROM `<t>`;
 *   DROP TABLE `<t>`;
 *   ALTER TABLE `__new_<t>` RENAME TO `<t>`;
 *
 * When such a recreation *also* adds a brand-new column in the same step,
 * drizzle-kit lists the new column in BOTH the INSERT column list AND the
 * SELECT column list. But the new column does not exist in the source table,
 * so `SELECT "<newcol>" FROM <t>` references a column that isn't there.
 *
 * Under SQLite's double-quoted-string (DQS) misfeature — which is active in
 * `bun:sqlite` regardless of `PRAGMA dqs` — a double-quoted unknown identifier
 * is silently treated as a **string literal** rather than raising an error.
 * The result is catastrophic, silent data corruption: every row's new column
 * is filled with the literal column-name string (e.g. `'target_alias_slug'`)
 * instead of NULL.
 *
 * This module fixes the generation pipeline so the `INSERT ... SELECT` emits
 * `NULL` for any destination column that is absent from the source
 * table (per the previous migration snapshot), and validates that no
 * source-absent column reference survives.
 *
 * It is generic: it inspects every `INSERT INTO \`__new_<t>\` ... SELECT ...
 * FROM \`<t>\`` in a migration, not any one hardcoded column.
 */

/** Column list shape we need from a drizzle snapshot. */
export interface SnapshotTable {
  columns: Record<string, unknown>;
}
export interface Snapshot {
  tables: Record<string, SnapshotTable>;
}

/**
 * Parse a drizzle column list like `"a", "b", "c"` into bare names.
 * Handles double-quoted identifiers and trims whitespace.
 */
function parseColumnList(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/^"(.*)"$/, '$1'));
}

/**
 * Parse a SELECT projection list like `"a", "b", NULL, "c"` into terms.
 * Each term retains its original textual form so it can be re-emitted verbatim
 * when kept; `isQuotedIdentifier` / `identifier` describe what it references.
 */
interface SelectTerm {
  /** Original text, trimmed (e.g. `"target_alias_slug"` or `NULL`). */
  raw: string;
  isQuotedIdentifier: boolean;
  identifier: string | null;
}

function parseSelectList(raw: string): SelectTerm[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const m = p.match(/^"([^"]+)"$/);
      if (m) return { raw: p, isQuotedIdentifier: true, identifier: m[1]! };
      return { raw: p, isQuotedIdentifier: false, identifier: null };
    });
}

/** Matches `INSERT INTO \`__new_<table>\`(...) SELECT ... FROM \`<table>\``. */
const TABLE_RECREATION_INSERT =
  /INSERT INTO `__new_(\w+)`\s*\(([^)]*)\)\s*SELECT\s+([\s\S]*?)\s+FROM\s+`(\w+)`/g;

export interface RecreationInsert {
  /** Full matched statement text (the regex match[0]). */
  fullMatch: string;
  sourceTable: string;
  insertColumns: string[];
  selectTerms: SelectTerm[];
}

/** Extract every table-recreation INSERT statement from a migration body. */
export function extractRecreationInserts(sql: string): RecreationInsert[] {
  const results: RecreationInsert[] = [];
  // Reset state in case the regex literal was used before (it's a /g regex).
  TABLE_RECREATION_INSERT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_RECREATION_INSERT.exec(sql)) !== null) {
    const sourceTable = m[4]!;
    const destTable = m[1]!;
    // The `__new_<dest>` and `FROM <source>` table names should agree. If they
    // ever disagree the migration is doing something we don't model; skip it
    // rather than guessing (validation will then flag it if it matters).
    if (destTable !== sourceTable) continue;
    results.push({
      fullMatch: m[0],
      sourceTable,
      insertColumns: parseColumnList(m[2]!),
      selectTerms: parseSelectList(m[3]!),
    });
  }
  return results;
}

/** Columns present on a table in a snapshot (empty if table/snapshot absent). */
export function snapshotTableColumns(
  snapshot: Snapshot | null | undefined,
  table: string
): Set<string> {
  if (!snapshot) return new Set();
  const t = snapshot.tables?.[table];
  if (!t || !t.columns) return new Set();
  return new Set(Object.keys(t.columns));
}

/**
 * Rewrite all table-recreation INSERT statements so destination columns absent
 * from the source snapshot are populated with NULL instead of a dangling
 * double-quoted identifier. Returns the rewritten SQL (unchanged if no
 * recreation inserts reference absent columns).
 *
 * Throws if an INSERT column list and SELECT projection have mismatched arity
 * (drizzle always emits them 1:1; a mismatch means unexpected SQL shape).
 */
export function rewriteTableRecreationInserts(
  sql: string,
  prevSnapshot: Snapshot | null | undefined
): string {
  const inserts = extractRecreationInserts(sql);
  if (inserts.length === 0) return sql;

  let out = sql;
  for (const ins of inserts) {
    if (ins.insertColumns.length !== ins.selectTerms.length) {
      throw new Error(
        `Cannot rewrite table recreation for "${ins.sourceTable}": INSERT has ` +
          `${ins.insertColumns.length} columns but SELECT has ${ins.selectTerms.length} terms`
      );
    }
    const sourceCols = snapshotTableColumns(prevSnapshot, ins.sourceTable);
    if (sourceCols.size === 0) {
      // No source schema to diff against (missing snapshot, or the table is
      // absent from it): we can't tell which columns are new, so leave the
      // statement untouched rather than risk an incorrect rewrite.
      continue;
    }

    let changed = false;
    const newTerms = ins.selectTerms.map((term) => {
      if (term.isQuotedIdentifier && term.identifier !== null && !sourceCols.has(term.identifier)) {
        changed = true;
        return 'NULL';
      }
      return term.raw;
    });

    if (!changed) continue;

    const newSelectList = newTerms.join(', ');
    const replacement =
      `INSERT INTO \`__new_${ins.sourceTable}\`` +
      `(${ins.insertColumns.map((c) => `"${c}"`).join(', ')}) ` +
      `SELECT ${newSelectList} FROM \`${ins.sourceTable}\``;
    // Replace only the first occurrence of this exact match (matches are unique
    // enough by their column list).
    out = out.replace(ins.fullMatch, replacement);
  }
  return out;
}

// ─── Journal / snapshot loading helpers (fs-backed) ────────────────────────

export interface JournalEntry {
  tag: string;
  when: number;
  breakpoints: boolean;
}
export interface Journal {
  entries: JournalEntry[];
}

/** Numeric 4-digit prefix of a migration tag (e.g. "0061_add_..." -> "0061"). */
export function migrationPrefix(tag: string): string {
  return tag.split('_')[0]!;
}

/** Load and parse a migration journal (`meta/_journal.json`). */
export function loadJournal(migrationsDir: string): Journal {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  let raw: string;
  try {
    raw = readFileSync(journalPath, 'utf8');
  } catch (e) {
    throw new Error(`Could not read migration journal at ${journalPath}: ${String(e)}`);
  }
  try {
    return JSON.parse(raw) as Journal;
  } catch (e) {
    throw new Error(`Corrupt migration journal at ${journalPath}: ${String(e)}`);
  }
}

/**
 * Load the snapshot describing schema state BEFORE a given migration applies.
 * For migration at journal index `i`, that is the snapshot produced by entry
 * `i-1`. Returns null for the first migration (empty DB) or if the file is
 * missing.
 */
export function loadPreviousSnapshot(
  migrationsDir: string,
  journal: Journal,
  migrationTag: string
): Snapshot | null {
  const idx = journal.entries.findIndex((e) => e.tag === migrationTag);
  if (idx <= 0) return null; // first migration, or unknown tag
  const prevTag = journal.entries[idx - 1]!.tag;
  const snapshotPath = join(migrationsDir, 'meta', `${migrationPrefix(prevTag)}_snapshot.json`);
  if (!existsSync(snapshotPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(snapshotPath, 'utf8');
  } catch (e) {
    throw new Error(`Could not read snapshot at ${snapshotPath}: ${String(e)}`);
  }
  try {
    return JSON.parse(raw) as Snapshot;
  } catch (e) {
    throw new Error(`Corrupt migration snapshot at ${snapshotPath}: ${String(e)}`);
  }
}

export interface ValidationOffense {
  migrationFile: string;
  sourceTable: string;
  absentColumns: string[];
}

/**
 * Validate that no table-recreation INSERT references a column absent from the
 * source snapshot. Returns the list of offenses (empty = clean).
 */
export function validateTableRecreationInserts(
  sql: string,
  migrationFile: string,
  prevSnapshot: Snapshot | null | undefined
): ValidationOffense[] {
  const offenses: ValidationOffense[] = [];
  for (const ins of extractRecreationInserts(sql)) {
    const sourceCols = snapshotTableColumns(prevSnapshot, ins.sourceTable);
    if (sourceCols.size === 0) continue; // unknown source state; skip
    const absent = ins.selectTerms
      .filter((t) => t.isQuotedIdentifier && t.identifier !== null && !sourceCols.has(t.identifier))
      .map((t) => t.identifier!);
    if (absent.length > 0) {
      offenses.push({
        migrationFile,
        sourceTable: ins.sourceTable,
        absentColumns: absent,
      });
    }
  }
  return offenses;
}
