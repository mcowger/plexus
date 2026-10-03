#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfillServiceTiers } from './lib/service-tier-backfill';

const DEFAULT_SOURCE = 'https://models.dev/api.json';
const DEFAULT_PRESETS = fileURLToPath(
  new URL('../packages/backend/data/provider-presets.json', import.meta.url)
);

export function parseArgs(args: string[]) {
  let source = DEFAULT_SOURCE;
  let presets = DEFAULT_PRESETS;
  let write = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--write') write = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--source' || arg === '--presets') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--source') source = value;
      else presets = resolve(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { source, presets, write, help };
}

export async function runBackfill(args: string[]) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(`Usage: bun run backfill:service-tiers [--write] [--source URL|FILE] [--presets FILE]

Backfill OpenAI and Anthropic preset tier maps from models.dev (dry-run by default).
Preserves configured model values, including null, and ignores pricing/reasoning modes.
New OpenAI models are Responses-only; existing Chat entries may gain non-Ultrafast tiers.
Anthropic recipes must match Plexus's supported speed and beta-header rewriting.
This edits preset defaults only, not providers already saved in the database.`);
    return;
  }
  const before = await readFile(options.presets, 'utf8');
  let source: unknown;
  if (/^https?:\/\//i.test(options.source)) {
    const response = await fetch(options.source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`models.dev request failed: HTTP ${response.status}`);
    source = await response.json();
  } else {
    source = JSON.parse(await readFile(resolve(options.source), 'utf8'));
  }
  const result = backfillServiceTiers(JSON.parse(before), source);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  for (const change of result.changes) console.log(change);
  console.log(
    `${result.changes.length} tier additions${options.write ? '' : ' (dry-run; use --write to apply)'}`
  );
  if (!options.write || result.changes.length === 0) return;
  const formatted = execFileSync(
    'bunx',
    ['biome', 'format', '--stdin-file-path', options.presets],
    {
      input: `${JSON.stringify(result.catalog, null, 2)}\n`,
      encoding: 'utf8',
    }
  );
  if ((await readFile(options.presets, 'utf8')) !== before)
    throw new Error('Preset file changed during backfill; refusing to overwrite');
  const temporary = `${options.presets}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, formatted, { flag: 'wx' });
    await rename(temporary, options.presets);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log(`Updated ${options.presets}`);
}

if (import.meta.main) {
  runBackfill(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
