import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { backfillServiceTiers } from '../lib/service-tier-backfill';
import { parseArgs } from '../backfill-service-tiers';

const mode = (body: Record<string, unknown>, headers?: Record<string, string>) => ({
  provider: { body, ...(headers && { headers }) },
});
const source = (openai: Record<string, unknown> = {}, anthropic: Record<string, unknown> = {}) => ({
  openai: { models: openai },
  anthropic: { models: anthropic },
});
const model = (modes: Record<string, unknown>) => ({ experimental: { modes } });
function catalog() {
  return {
    $comment: 'preserve me',
    presets: [
      {
        id: 'openai',
        name: 'OpenAI',
        suggestedProviderId: 'openai',
        suggestedName: 'OpenAI',
        apiBaseUrl: { chat: 'https://example.test', responses: 'https://example.test' },
        piAiProvider: 'openai',
        autoCompat: true,
        piAiQuirks: {
          chat: {
            api: 'openai-completions',
            serviceTierMap: { auto: 'auto', standard: 'default', priority: null },
            models: { existing: { serviceTierMap: { standard: 'default' } } },
          },
          responses: {
            api: 'openai-responses',
            serviceTierMap: {
              auto: 'auto',
              standard: 'default',
              flex: null,
              priority: null,
              ultrafast: null,
            },
          },
        },
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        suggestedProviderId: 'anthropic',
        suggestedName: 'Anthropic',
        apiBaseUrl: { messages: 'https://example.test' },
        piAiProvider: 'anthropic',
        autoCompat: true,
        piAiQuirks: {
          messages: { api: 'anthropic-messages', compat: { serviceTierFormat: 'anthropic-speed' } },
        },
      },
    ],
  };
}

describe('models.dev service tier backfill', () => {
  it('adds canonical tiers, inherits target defaults, ignores reasoning and prices, and is idempotent', () => {
    const input = catalog();
    const data = source(
      {
        newer: model({
          fast: mode({ service_tier: 'priority' }),
          flex: mode({ service_tier: 'flex' }),
          pro: mode({ reasoning: { mode: 'pro' } }),
        }),
      },
      {
        opus: model({
          fast: mode({ speed: 'fast' }, { 'anthropic-beta': 'fast-mode-2026-02-01' }),
        }),
      }
    );
    const result = backfillServiceTiers(input, data);
    expect(result.changes).toHaveLength(3);
    const openai = result.catalog.presets[0]!;
    expect(openai.piAiQuirks?.responses?.models?.newer).toEqual({
      serviceTierMap: {
        auto: 'auto',
        standard: 'default',
        flex: 'flex',
        priority: 'priority',
        ultrafast: null,
      },
    });
    expect(openai.piAiQuirks?.chat?.models?.newer).toBeUndefined();
    expect(result.catalog.presets[1]!.piAiQuirks?.messages?.models?.opus?.serviceTierMap).toEqual({
      priority: 'fast',
    });
    expect(result.catalog.$comment).toBe('preserve me');
    expect(input).toEqual(catalog());
    expect(backfillServiceTiers(result.catalog, data).changes).toEqual([]);
    expect(backfillServiceTiers(result.catalog, data).catalog).toEqual(result.catalog);
  });

  it('preserves explicit model restrictions, native values and unrelated quirks', () => {
    const input = catalog();
    input.presets[0]!.piAiQuirks.responses = {
      api: 'openai-responses',
      models: {
        existing: { serviceTierMap: { flex: null, priority: 'reserved' }, maxTokens: 1000 },
      },
    } as any;
    const result = backfillServiceTiers(
      input,
      source({
        existing: model({
          fast: mode({ service_tier: 'priority' }),
          flex: mode({ service_tier: 'flex' }),
        }),
      })
    );
    expect(result.warnings).toHaveLength(2);
    expect(result.catalog.presets[0]!.piAiQuirks?.responses?.models?.existing).toEqual(
      input.presets[0]!.piAiQuirks.responses.models!.existing
    );
    expect(result.catalog.presets[0]!.piAiQuirks?.chat?.models?.existing?.serviceTierMap).toEqual({
      standard: 'default',
      flex: 'flex',
      priority: 'priority',
    });
  });

  it('deduplicates additions and preserves the first conflicting source mode', () => {
    const input = catalog();
    input.presets[0]!.piAiQuirks.responses.serviceTierMap.standard = null as any;
    const result = backfillServiceTiers(
      input,
      source({
        newer: model({
          first: mode({ service_tier: 'default' }),
          duplicate: mode({ service_tier: 'default' }),
          conflicting: mode({ service_tier: 'standard' }),
        }),
      })
    );
    expect(result.changes).toEqual(['openai/newer/responses: standard -> default']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('conflicting models.dev modes');
    expect(
      result.catalog.presets[0]!.piAiQuirks?.responses?.models?.newer?.serviceTierMap?.standard
    ).toBe('default');
  });

  it('preserves inherited strings without redundant model overrides', () => {
    const input = catalog();
    const result = backfillServiceTiers(
      input,
      source({
        newer: model({
          identical: mode({ service_tier: 'default' }),
          conflicting: mode({ service_tier: 'standard' }),
          positive: mode({ service_tier: 'priority' }),
        }),
      })
    );
    expect(result.changes).toEqual(['openai/newer/responses: priority -> priority']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('inherited');
    expect(
      result.catalog.presets[0]!.piAiQuirks?.responses?.models?.newer?.serviceTierMap?.standard
    ).toBe('default');
    const unchanged = backfillServiceTiers(
      input,
      source({ newer: model({ identical: mode({ service_tier: 'default' }) }) })
    );
    expect(unchanged.changes).toEqual([]);
    expect(unchanged.catalog).toEqual(input);
  });

  it('keeps ultrafast off Chat and honors explicit endpoint shapes', () => {
    const result = backfillServiceTiers(
      catalog(),
      source({
        existing: model({ ultra: mode({ service_tier: 'ultrafast' }) }),
        chatOnly: {
          ...model({ fast: mode({ service_tier: 'priority' }) }),
          provider: { shape: 'completions' },
        },
      })
    );
    expect(result.changes).toEqual(['openai/existing/responses: ultrafast -> ultrafast']);
    expect(result.catalog.presets[0]!.piAiQuirks?.chat?.models?.existing?.serviceTierMap).toEqual({
      standard: 'default',
    });
  });

  it('skips unrepresentable recipes and changed beta requirements', () => {
    const result = backfillServiceTiers(
      catalog(),
      source(
        {
          unknown: model({ tier: mode({ service_tier: 'reserved' }) }),
          combined: model({ fast: mode({ service_tier: 'priority', reasoning: {} }) }),
          customHeader: model({ fast: mode({ service_tier: 'priority' }, { custom: 'required' }) }),
        },
        {
          changed: model({ fast: mode({ speed: 'fast' }, { 'anthropic-beta': 'future-beta' }) }),
          missing: model({ fast: mode({ speed: 'fast' }) }),
        }
      )
    );
    expect(result.changes).toEqual([]);
    expect(result.warnings).toHaveLength(5);
    expect(result.catalog).toEqual(catalog());
  });

  it('rejects malformed source and preset data before updating', () => {
    expect(() => backfillServiceTiers(catalog(), {})).toThrow();
    expect(() =>
      backfillServiceTiers(catalog(), { openai: { models: [] }, anthropic: { models: {} } })
    ).toThrow();
    expect(() => backfillServiceTiers({}, source())).toThrow();
    expect(backfillServiceTiers(catalog(), source()).changes).toEqual([]);
  });

  it('parses CLI options and rejects unknown or incomplete arguments', () => {
    expect(parseArgs([]).write).toBe(false);
    expect(parseArgs(['--write', '--source', 'snapshot.json']).source).toBe('snapshot.json');
    expect(parseArgs(['--help']).help).toBe(true);
    expect(() => parseArgs(['--source'])).toThrow();
    expect(() => parseArgs(['--bad'])).toThrow();
  });

  it('dry-runs and writes a local snapshot through the Bun CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'plexus-tier-backfill-'));
    try {
      const presets = join(directory, 'presets.json');
      const snapshot = join(directory, 'source.json');
      const before = JSON.stringify(catalog(), null, 2);
      await writeFile(presets, before);
      await writeFile(
        snapshot,
        JSON.stringify(source({ newer: model({ fast: mode({ service_tier: 'priority' }) }) }))
      );
      const script = new URL('../backfill-service-tiers.ts', import.meta.url).pathname;
      const args = [script, '--source', snapshot, '--presets', presets];
      expect(execFileSync('bun', args, { encoding: 'utf8' })).toContain('dry-run');
      expect(await readFile(presets, 'utf8')).toBe(before);
      expect(execFileSync('bun', [...args, '--write'], { encoding: 'utf8' })).toContain('Updated');
      const updated = await readFile(presets, 'utf8');
      expect(
        JSON.parse(updated).presets[0].piAiQuirks.responses.models.newer.serviceTierMap.priority
      ).toBe('priority');
      expect(execFileSync('bun', [...args, '--write'], { encoding: 'utf8' })).toContain(
        '0 tier additions'
      );
      expect(await readFile(presets, 'utf8')).toBe(updated);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
