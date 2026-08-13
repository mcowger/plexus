#!/usr/bin/env bun
import { $ } from 'bun';
import { parseArgs } from 'util';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadJournal,
  loadPreviousSnapshot,
  rewriteTableRecreationInserts,
  validateTableRecreationInserts,
} from './lib/sqlite-migration-rewrite';

const VALID_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

function showUsage() {
  console.error('Usage: bun run generate-migrations [--name <descriptive-name>]');
  console.error('');
  console.error('If --name is omitted on a non-main branch, the name is derived from');
  console.error('the branch name automatically. On main, --name is required.');
  console.error('');
  console.error('Examples:');
  console.error(
    '  bun run generate-migrations                        # auto-derives name from branch'
  );
  console.error('  bun run generate-migrations --name add_user_preferences');
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: 'string' },
  },
  strict: false,
  allowPositionals: true,
});

let name = values.name as string | undefined;

if (!name) {
  // Determine current branch
  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    console.error('Error: Could not determine current git branch.');
    console.error('Please provide --name explicitly.');
    process.exit(1);
  }

  if (branch === 'main' || branch === 'master') {
    console.error('Error: --name is required when running on the main/master branch.');
    console.error('Automatic naming is only available on feature branches.');
    showUsage();
  }

  if (branch === 'HEAD') {
    console.error('Error: Detached HEAD detected. Please provide --name explicitly.');
    showUsage();
  }

  name = deriveNameFromBranch(branch);
  console.log(`No --name provided; derived migration name from branch: ${name}`);
}

if (!VALID_NAME_REGEX.test(name)) {
  console.error(`Error: Migration name "${name}" is invalid.`);
  console.error('Names must be snake_case: lowercase letters, numbers, and underscores only.');
  console.error('They must start with a letter.');
  process.exit(1);
}

// Capture the set of SQLite migration files *before* generation so we can
// post-process only the freshly generated one(s).
const SQLITE_MIGRATIONS_DIR = join('packages', 'backend', 'drizzle', 'migrations');
const beforeSqlite = new Set(listSqlFiles(SQLITE_MIGRATIONS_DIR));

console.log(`Generating SQLite migrations with name: ${name}`);
await $`cd packages/backend && node node_modules/drizzle-kit/bin.cjs generate --name ${name} --config drizzle.config.sqlite.ts`;

// drizzle-kit's SQLite table-recreation codegen references new columns in the
// `INSERT ... SELECT` that don't exist on the source table. Under SQLite's
// double-quoted-string misfeature this silently writes the literal column
// name into every row. Rewrite those SELECT terms to NULL and validate.
postProcessSqliteMigrations(SQLITE_MIGRATIONS_DIR, beforeSqlite);

console.log(`Generating Postgres migrations with name: ${name}`);
await $`cd packages/backend && node node_modules/drizzle-kit/bin.cjs generate --name ${name} --config drizzle.config.postgres.ts`;

console.log('Done!');

/** List `*.sql` filenames in a migrations directory (names only). */
function listSqlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.sql'));
  } catch {
    return [];
  }
}

/**
 * Rewrite + validate freshly generated SQLite migration files so table
 * recreations never SELECT a column absent from the source snapshot.
 *
 * This guards against the SQLite double-quoted-string data-corruption bug
 * where `INSERT INTO __new_t (..., "newcol", ...) SELECT ..., "newcol", ... FROM t`
 * silently fills `newcol` with the literal string 'newcol'.
 */
function postProcessSqliteMigrations(dir: string, before: Set<string>): void {
  const after = listSqlFiles(dir);
  const newFiles = after.filter((f) => !before.has(f));
  if (newFiles.length === 0) return;

  const journal = loadJournal(dir);

  for (const file of newFiles) {
    const filePath = join(dir, file);
    const original = readFileSync(filePath, 'utf8');
    // The migration tag is the filename without `.sql`.
    const tag = file.replace(/\.sql$/, '');
    const prevSnapshot = loadPreviousSnapshot(dir, journal, tag);

    const rewritten = rewriteTableRecreationInserts(original, prevSnapshot);
    if (rewritten !== original) {
      writeFileSync(filePath, rewritten);
      console.log(
        `Rewrote table-recreation INSERT...SELECT in ${file} (NULL for source-absent columns)`
      );
    }

    // Fail generation if anything dangerous survives the rewrite.
    const offenses = validateTableRecreationInserts(
      readFileSync(filePath, 'utf8'),
      file,
      prevSnapshot
    );
    if (offenses.length > 0) {
      console.error(
        `Error: SQLite table-recreation migration ${file} still references ` +
          'columns absent from the source snapshot (would silently corrupt data under SQLite DQS):'
      );
      for (const o of offenses) {
        console.error(`  table ${o.sourceTable}: ${o.absentColumns.join(', ')}`);
      }
      console.error(
        'Fix the migration so the INSERT...SELECT uses NULL for any column new to the source table.'
      );
      process.exit(1);
    }
  }
}

/**
 * Derive a descriptive migration name from a git branch name.
 *
 * Examples:
 *   pi/issue-424-1779050379120 → auto_issue_424
 *   feat/quota-checkers        → auto_quota_checkers
 *   fix/user-index             → auto_user_index
 *   424-migration-naming       → auto_424_migration_naming
 */
function deriveNameFromBranch(branch: string): string {
  // Strip common VCS/automation prefixes (pi/, feat/, fix/, feature/, bugfix/, etc.)
  let derived = branch.replace(
    /^(pi|feat|feature|fix|bugfix|hotfix|chore|refactor|docs|test|ci)\//,
    ''
  );

  // Strip trailing long numeric hashes (e.g., 1779050379120) likely added by automation
  derived = derived.replace(/[-_]?\d{10,}$/, '');

  // Replace non-alphanumeric characters with underscores
  derived = derived.replace(/[^a-zA-Z0-9]+/g, '_');

  // Collapse multiple consecutive underscores
  derived = derived.replace(/_+/g, '_');

  // Strip leading/trailing underscores
  derived = derived.replace(/^_+|_+$/g, '');

  // Lowercase
  derived = derived.toLowerCase();

  // Prefix with auto_ so lint-migrations recognizes it
  derived = `auto_${derived}`;

  // Safety check: if we ended up with just "auto_" or empty, fall back
  if (derived === 'auto_' || derived.length <= 5) {
    console.error(`Error: Could not derive a meaningful name from branch "${branch}".`);
    console.error('Please provide --name explicitly.');
    process.exit(1);
  }

  return derived;
}
