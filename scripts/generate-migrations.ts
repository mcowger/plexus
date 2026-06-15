#!/usr/bin/env bun
import { $ } from 'bun';
import { parseArgs } from 'util';
import { execSync } from 'node:child_process';

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

console.log(`Generating SQLite migrations with name: ${name}`);
await $`cd packages/backend && node node_modules/drizzle-kit/bin.cjs generate --name ${name} --config drizzle.config.sqlite.ts`;

console.log(`Generating Postgres migrations with name: ${name}`);
await $`cd packages/backend && node node_modules/drizzle-kit/bin.cjs generate --name ${name} --config drizzle.config.postgres.ts`;

console.log('Done!');

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
