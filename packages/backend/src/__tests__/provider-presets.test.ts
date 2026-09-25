import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  ProviderPresetSchema,
  PiAiQuirksSchema,
  applyProviderPreset,
  findProviderPreset,
  findUnresolvedPresetVars,
  substitutePresetVars,
  type ProviderPreset,
  type ProviderPresetDraft,
} from '@plexus/shared';
import editorSchema from '../../data/provider-presets.schema.json' with { type: 'json' };
import {
  REMOTE_PRESETS_URL,
  defaultPresetsPath,
  diskFileEditedSinceStartup,
  loadLocalPresets,
  loadProviderPresets,
  parseAndValidatePresets,
} from '../services/provider-presets';

let catalog: ProviderPreset[] = [];

beforeAll(async () => {
  catalog = await loadLocalPresets();
});

const blankDraft = (): ProviderPresetDraft => ({
  id: '',
  name: '',
  apiBaseUrl: {},
  apiKey: '',
  oauthProvider: '',
  type: [],
  pi_ai_provider: undefined,
  pi_ai_quirks: undefined,
  auto_compat: undefined,
});

const presetOrThrow = (id: string): ProviderPreset => {
  const preset = findProviderPreset(catalog, id);
  if (!preset) throw new Error(`preset '${id}' missing from catalog`);
  return preset;
};

const remoteEntry = {
  id: 'remote-only',
  name: 'Remote Only',
  suggestedProviderId: 'remote-only',
  suggestedName: 'Remote Only',
  apiBaseUrl: { chat: 'https://remote.test/v1' },
  piAiProvider: 'openai',
  autoCompat: true,
};

const inlineEntry = {
  id: 'inline',
  name: 'Inline',
  suggestedProviderId: 'inline',
  suggestedName: 'Inline',
  apiBaseUrl: {
    chat: 'https://inline.test/v1',
    messages: 'https://inline.test/anthropic/v1',
  },
  piAiQuirks: {
    chat: {
      api: 'openai-completions',
      reasoning: true,
      thinkingLevelMap: { off: null, high: 'high' },
      compat: { maxTokensField: 'max_completion_tokens' },
      models: {
        'team/model-1': {
          thinkingLevelMap: { low: 'low' },
          compat: { supportsTemperature: false },
        },
      },
    },
    messages: {
      api: 'anthropic-messages',
      models: { 'team/model-1': { reasoning: true, maxTokens: 4096 } },
    },
  },
};

const plainEntry = {
  id: 'plain',
  name: 'Plain',
  suggestedProviderId: 'plain',
  suggestedName: 'Plain',
  apiBaseUrl: { chat: 'https://plain.test/v1' },
};

const editorCatalog = (entry: unknown) => ({
  $schema: editorSchema.$id,
  presets: [entry],
});

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validateEditorCatalog = ajv.compile(editorSchema);

describe('built-in presets catalog (data/provider-presets.json)', () => {
  test('loads a non-empty catalog from the default path', async () => {
    expect(defaultPresetsPath().endsWith(join('data', 'provider-presets.json'))).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  test('every URL is a valid http(s) URL once template vars are filled', () => {
    for (const preset of catalog) {
      const filled = substitutePresetVars(
        preset.apiBaseUrl,
        Object.fromEntries(preset.templateVars.map((variable) => [variable.key, 'test']))
      );
      for (const [apiType, url] of Object.entries(filled)) {
        expect(url, `${preset.id}.${apiType} has an unsubstituted placeholder`).not.toContain('{');
        const parsed = new URL(url);
        expect(['http:', 'https:']).toContain(parsed.protocol);
        expect(parsed.search, `${preset.id}.${apiType} must not carry a query`).toBe('');
        expect(parsed.hash, `${preset.id}.${apiType} must not carry a fragment`).toBe('');
      }
    }
  });

  test('spot-checks on researched endpoint maps', () => {
    expect(presetOrThrow('anthropic').apiBaseUrl).toEqual({
      messages: 'https://api.anthropic.com/v1',
    });
    // Anthropic-compatible bases carry /v1 because Plexus appends /messages.
    expect(presetOrThrow('moonshot').apiBaseUrl.messages).toBe(
      'https://api.moonshot.ai/anthropic/v1'
    );
    expect(presetOrThrow('openrouter').apiBaseUrl['openrouter-decisions']).toBe(
      'https://openrouter.ai/api/alpha'
    );
    // DeepSeek chat has no /v1 segment upstream.
    expect(presetOrThrow('deepseek').apiBaseUrl.chat).toBe('https://api.deepseek.com');
  });
});

describe('loadLocalPresets failures', () => {
  test('missing disk file falls back to the embedded catalog (release binaries)', async () => {
    const presets = await loadLocalPresets(join(tmpdir(), 'no-such-presets.json'));
    expect(presets.length).toBe(catalog.length);
    expect(presets.map((preset) => preset.id)).toEqual(catalog.map((preset) => preset.id));
  });

  test('malformed JSON throws a descriptive error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'presets-'));
    const file = join(dir, 'presets.json');
    writeFileSync(file, '{ not json');
    await expect(loadLocalPresets(file)).rejects.toThrow(/unreadable/);
  });

  test('schema violations and duplicate ids throw with detail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'presets-'));
    const invalidFile = join(dir, 'invalid.json');
    writeFileSync(invalidFile, JSON.stringify({ presets: [{ id: 'broken', apiBaseUrl: {} }] }));
    await expect(loadLocalPresets(invalidFile)).rejects.toThrow(/Invalid provider presets/);

    const entry = {
      id: 'dup',
      name: 'Dup',
      suggestedProviderId: 'dup',
      suggestedName: 'Dup',
      apiBaseUrl: { chat: 'https://example.test/v1' },
      piAiProvider: 'openai',
      autoCompat: true,
    };
    const dupFile = join(dir, 'dup.json');
    writeFileSync(dupFile, JSON.stringify({ presets: [entry, entry] }));
    await expect(loadLocalPresets(dupFile)).rejects.toThrow(/Duplicate provider preset id/);
  });
});

describe('diskFileEditedSinceStartup', () => {
  test('fresh files count as edited, pristine catalog does not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'presets-'));
    const fresh = join(dir, 'fresh.json');
    writeFileSync(fresh, '{}');
    expect(await diskFileEditedSinceStartup(fresh)).toBe(true);
    expect(await diskFileEditedSinceStartup(defaultPresetsPath())).toBe(false);
    expect(await diskFileEditedSinceStartup(join(dir, 'missing.json'))).toBe(false);
  });
});

describe('loadProviderPresets remote source', () => {
  let handler: (req: Request) => Response = () =>
    new Response(JSON.stringify({ presets: [remoteEntry] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
    handler = () =>
      new Response(JSON.stringify({ presets: [remoteEntry] }), {
        headers: { 'Content-Type': 'application/json' },
      });
  });

  const serve = () => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) => handler(req),
    });
    return `http://127.0.0.1:${server.port}/presets.json`;
  };

  test('default source is the plexus repo raw GitHub URL', () => {
    expect(REMOTE_PRESETS_URL).toBe(
      'https://raw.githubusercontent.com/mcowger/plexus/main/packages/backend/data/provider-presets.json'
    );
  });

  test('serves the remote catalog on success', async () => {
    const result = await loadProviderPresets(serve());
    expect(result.source).toBe('remote');
    expect(result.presets).toEqual([
      expect.objectContaining({ id: 'remote-only', piAiProvider: 'openai' }),
    ]);
  });

  test('unreachable remote, error status, and bad content fall back to built-in', async () => {
    const unreachable = await loadProviderPresets('http://127.0.0.1:1/presets.json');
    expect(unreachable.source).toBe('local');
    expect(unreachable.presets.length).toBe(catalog.length);

    handler = () => new Response('nope', { status: 500 });
    const errorStatus = await loadProviderPresets(serve());
    expect(errorStatus.source).toBe('local');

    handler = () => new Response('<html>not json</html>');
    const garbage = await loadProviderPresets(serve());
    expect(garbage.source).toBe('local');

    handler = () => Response.json({ presets: [{ id: 'broken' }] });
    const invalid = await loadProviderPresets(serve());
    expect(invalid.source).toBe('local');
    expect(invalid.presets.length).toBe(catalog.length);
  });

  test('invalid inline remote entry rejects the entire catalog and serves the local copy', async () => {
    handler = () =>
      Response.json({
        presets: [
          remoteEntry,
          { ...inlineEntry, piAiQuirks: { chat: { api: 'openai-completions', typo: true } } },
        ],
      });
    const result = await loadProviderPresets(serve());
    expect(result.source).toBe('local');
    expect(result.presets.some((entry) => entry.id === remoteEntry.id)).toBe(false);
  });
});

describe('strict catalog validation', () => {
  const validEntry = {
    id: 'strict',
    name: 'Strict',
    suggestedProviderId: 'strict',
    suggestedName: 'Strict',
    apiBaseUrl: { chat: 'https://example.test/v1' },
    piAiProvider: 'openai',
    autoCompat: true,
  };

  test.each([
    ['javascript: docsUrl', { ...validEntry, docsUrl: 'javascript:alert(1)' }],
    ['non-http endpoint', { ...validEntry, apiBaseUrl: { chat: 'ftp://example.test/v1' } }],
    [
      'undeclared placeholder',
      { ...validEntry, apiBaseUrl: { chat: 'https://{region}.example.test/v1' } },
    ],
    [
      'prototype-shadowing templateVar key',
      {
        ...validEntry,
        apiBaseUrl: { chat: 'https://example.test/{toString}/v1' },
        templateVars: [{ key: 'toString', label: 'Bad' }],
      },
    ],
    ['prototype-named experimental api', { ...validEntry, experimentalApis: ['toString'] }],
    ['plain-http endpoint', { ...validEntry, apiBaseUrl: { chat: 'http://example.test/v1' } }],
    ['plain-http docsUrl', { ...validEntry, docsUrl: 'http://example.test/docs' }],
  ])('rejects %s', (_label, entry) => {
    expect(ProviderPresetSchema.safeParse(entry).success).toBe(false);
  });
});

describe('three quirk source modes', () => {
  test('parses builtin, inline (including per-model overrides), and plain presets', () => {
    const builtin = ProviderPresetSchema.parse(remoteEntry);
    const inline = ProviderPresetSchema.parse(inlineEntry);
    const plain = ProviderPresetSchema.parse(plainEntry);

    expect(builtin.piAiProvider).toBe('openai');
    expect(builtin.piAiQuirks).toBeUndefined();
    expect(inline.piAiProvider).toBeUndefined();
    expect(inline.piAiQuirks?.chat?.models?.['team/model-1']).toEqual({
      thinkingLevelMap: { low: 'low' },
      compat: { supportsTemperature: false },
    });
    expect(inline.piAiQuirks?.messages?.models?.['team/model-1']?.maxTokens).toBe(4096);
    expect(inline.autoCompat).toBe(false);
    expect(plain.piAiProvider).toBeUndefined();
    expect(plain.piAiQuirks).toBeUndefined();
    expect(plain.autoCompat).toBe(false);
    for (const entry of [builtin, inline, plain]) {
      expect(
        validateEditorCatalog(editorCatalog(entry)),
        JSON.stringify(validateEditorCatalog.errors)
      ).toBe(true);
    }
  });

  test('allows a model to opt out of target-wide reasoning without claiming a reasoning map', () => {
    const entry = {
      ...inlineEntry,
      piAiQuirks: {
        chat: {
          api: 'openai-completions',
          reasoning: true,
          thinkingLevelMap: { high: 'high' },
          models: { 'team/no-reasoning': { reasoning: false } },
        },
      },
    };
    expect(
      ProviderPresetSchema.parse(entry).piAiQuirks?.chat?.models?.['team/no-reasoning']
    ).toEqual({
      reasoning: false,
    });
    expect(validateEditorCatalog(editorCatalog(entry))).toBe(true);
  });

  test.each([
    ['both sources', { ...inlineEntry, piAiProvider: 'openai' }],
    ['empty quirks', { ...inlineEntry, piAiQuirks: {} }],
    [
      'quirks on an unconfigured target',
      { ...inlineEntry, piAiQuirks: { responses: { api: 'openai-responses' } } },
    ],
    ['auto-compat without a source', { ...plainEntry, autoCompat: true }],
    ['empty endpoint map', { ...inlineEntry, apiBaseUrl: {} }],
    [
      'unsupported protocol',
      { ...inlineEntry, piAiQuirks: { audio: { api: 'openai-completions' } } },
    ],
    ['mismatched dialect', { ...inlineEntry, piAiQuirks: { chat: { api: 'anthropic-messages' } } }],
    [
      'unknown target trait',
      { ...inlineEntry, piAiQuirks: { chat: { api: 'openai-completions', maxToken: 4096 } } },
    ],
    [
      'unknown model trait',
      {
        ...inlineEntry,
        piAiQuirks: { chat: { api: 'openai-completions', models: { 'team/a': { maxToken: 42 } } } },
      },
    ],
    [
      'unknown compat flag',
      {
        ...inlineEntry,
        piAiQuirks: { chat: { api: 'openai-completions', compat: { thinkingForma: 'zai' } } },
      },
    ],
    [
      'unsupported compat enum value',
      {
        ...inlineEntry,
        piAiQuirks: { chat: { api: 'openai-completions', compat: { thinkingFormat: 'other' } } },
      },
    ],
    [
      'invalid maxTokens bound',
      { ...inlineEntry, piAiQuirks: { chat: { api: 'openai-completions', maxTokens: -1 } } },
    ],
    [
      'reasoning map without declared reasoning',
      {
        ...inlineEntry,
        piAiQuirks: { chat: { api: 'openai-completions', thinkingLevelMap: { high: 'high' } } },
      },
    ],
    [
      'unsupported model reasoning override',
      {
        ...inlineEntry,
        piAiQuirks: {
          chat: {
            api: 'openai-completions',
            reasoning: true,
            models: { 'team/a': { reasoning: false, thinkingLevelMap: { low: 'low' } } },
          },
        },
      },
    ],
  ])('runtime and editor reject %s', (_label, entry) => {
    expect(ProviderPresetSchema.safeParse(entry).success).toBe(false);
    expect(
      validateEditorCatalog(editorCatalog(entry)),
      JSON.stringify(validateEditorCatalog.errors)
    ).toBe(false);
  });

  test('runtime also rejects invalid model reasoning inherited from an unknown common target', () => {
    const quirks = {
      chat: {
        api: 'openai-completions',
        models: { 'team/a': { thinkingLevelMap: { high: 'high' } } },
      },
    };
    expect(PiAiQuirksSchema.safeParse(quirks).success).toBe(false);
    expect(ProviderPresetSchema.safeParse({ ...inlineEntry, piAiQuirks: quirks }).success).toBe(
      false
    );
  });

  test('runtime catches placeholder references and duplicate IDs beyond editor validation', () => {
    const badPlaceholder = {
      ...remoteEntry,
      apiBaseUrl: { chat: 'https://{region}.test/v1' },
    };
    expect(validateEditorCatalog(editorCatalog(badPlaceholder))).toBe(true);
    expect(() => parseAndValidatePresets(editorCatalog(badPlaceholder), 'test')).toThrow(
      /every \{placeholder\}/
    );

    const duplicates = { $schema: editorSchema.$id, presets: [remoteEntry, remoteEntry] };
    expect(validateEditorCatalog(duplicates)).toBe(true);
    expect(() => parseAndValidatePresets(duplicates, 'test')).toThrow(
      /Duplicate provider preset id/
    );
  });
});

describe('findUnresolvedPresetVars', () => {
  test('lists placeholders and ignores resolved URLs', () => {
    expect(
      findUnresolvedPresetVars({
        chat: 'https://api.example.test/v1',
        messages: 'https://api.example.test/{account_id}/v1',
      })
    ).toEqual(['account_id']);
    expect(findUnresolvedPresetVars({ chat: 'https://api.example.test/v1' })).toEqual([]);
  });
});

describe('substitutePresetVars', () => {
  test('replaces known placeholders and leaves unknown ones visible', () => {
    expect(
      substitutePresetVars(
        { chat: 'https://x.test/{account_id}/v1', other: 'https://y.test/{missing}/v1' },
        { account_id: 'abc' }
      )
    ).toEqual({
      chat: 'https://x.test/abc/v1',
      other: 'https://y.test/{missing}/v1',
    });
  });

  test('blank values do not substitute', () => {
    expect(
      substitutePresetVars({ chat: 'https://x.test/{account_id}/v1' }, { account_id: '  ' })
    ).toEqual({ chat: 'https://x.test/{account_id}/v1' });
  });
});

describe('applyProviderPreset', () => {
  test('fills a blank draft with endpoints, types, and pi-ai mapping', () => {
    const preset = presetOrThrow('moonshot');
    const applied = applyProviderPreset(blankDraft(), preset);

    expect(applied.id).toBe('moonshot');
    expect(applied.name).toBe('Moonshot');
    expect(applied.apiBaseUrl).toEqual(preset.apiBaseUrl);
    expect(applied.type).toEqual(['chat', 'responses', 'messages']);
    expect(applied.pi_ai_provider).toBe('moonshotai');
    expect(applied.auto_compat).toBe(true);
  });

  test('switches builtin → inline → plain without retaining a previous source', () => {
    const builtin = ProviderPresetSchema.parse(remoteEntry);
    const inline = ProviderPresetSchema.parse({ ...inlineEntry, autoCompat: true });
    const plain = ProviderPresetSchema.parse(plainEntry);

    const first = applyProviderPreset(blankDraft(), builtin);
    const second = applyProviderPreset(first, inline, {}, builtin);
    expect(second.pi_ai_provider).toBeUndefined();
    expect(second.pi_ai_quirks).toEqual(inline.piAiQuirks);
    expect(second.pi_ai_quirks).not.toBe(inline.piAiQuirks);
    expect(second.pi_ai_quirks?.chat?.models?.['team/model-1']).not.toBe(
      inline.piAiQuirks?.chat?.models?.['team/model-1']
    );
    expect(second.auto_compat).toBe(true);
    expect(first.pi_ai_provider).toBe('openai');
    expect(first.pi_ai_quirks).toBeUndefined();

    const third = applyProviderPreset(second, plain, {}, inline);
    expect(third.pi_ai_provider).toBeUndefined();
    expect(third.pi_ai_quirks).toBeUndefined();
    expect(third.auto_compat).toBe(false);
    expect(third.id).toBe('plain');
    expect(third.type).toEqual(['chat']);
    const fourth = applyProviderPreset(third, builtin, {}, plain);
    expect(fourth.pi_ai_provider).toBe('openai');
    expect(fourth.pi_ai_quirks).toBeUndefined();
    expect(fourth.auto_compat).toBe(true);
  });

  test('copies nested inline overrides so editing a draft cannot mutate its preset', () => {
    const inline = ProviderPresetSchema.parse(inlineEntry);
    const first = applyProviderPreset(blankDraft(), inline);
    first.pi_ai_quirks!.chat!.models!['team/model-1']!.compat!.supportsTemperature = true;
    const second = applyProviderPreset(blankDraft(), inline);
    expect(second.pi_ai_quirks?.chat?.models?.['team/model-1']?.compat?.supportsTemperature).toBe(
      false
    );
    expect(second.auto_compat).toBe(false);
  });

  test('never overwrites an existing id or name', () => {
    const preset = presetOrThrow('openai');
    const applied = applyProviderPreset({ ...blankDraft(), id: 'my-openai', name: 'Mine' }, preset);

    expect(applied.id).toBe('my-openai');
    expect(applied.name).toBe('Mine');
    expect(applied.apiBaseUrl).toEqual(preset.apiBaseUrl);
  });

  test('clears OAuth-mode leftovers since presets are API-key providers', () => {
    const preset = presetOrThrow('groq');
    const applied = applyProviderPreset(
      { ...blankDraft(), apiBaseUrl: 'oauth://', apiKey: 'oauth', oauthProvider: 'meta' },
      preset
    );

    expect(applied.apiBaseUrl).toEqual(preset.apiBaseUrl);
    expect(applied.apiKey).toBe('');
    expect(applied.oauthProvider).toBe('');
  });

  test('preserves a typed API key', () => {
    const preset = presetOrThrow('groq');
    const applied = applyProviderPreset({ ...blankDraft(), apiKey: 'sk-live' }, preset);

    expect(applied.apiKey).toBe('sk-live');
  });

  test('substitutes template vars into the endpoint map', () => {
    const preset = presetOrThrow('cloudflare');
    const applied = applyProviderPreset(blankDraft(), preset, { account_id: 'acct123' });

    expect(applied.apiBaseUrl).toEqual({
      chat: 'https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1',
      messages: 'https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1',
      responses: 'https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1',
    });
  });

  test('switching presets overwrites fields still holding the previous suggestion', () => {
    const openai = presetOrThrow('openai');
    const moonshot = presetOrThrow('moonshot');
    const first = applyProviderPreset(blankDraft(), openai);
    expect(first.id).toBe('openai');

    const second = applyProviderPreset(first, moonshot, {}, openai);
    expect(second.id).toBe('moonshot');
    expect(second.name).toBe('Moonshot');
    expect(second.apiBaseUrl).toEqual(moonshot.apiBaseUrl);
  });

  test('switching presets preserves operator-typed id and name', () => {
    const openai = presetOrThrow('openai');
    const moonshot = presetOrThrow('moonshot');
    const first = applyProviderPreset({ ...blankDraft(), id: 'mine', name: 'Mine' }, openai);
    const second = applyProviderPreset(first, moonshot, {}, openai);
    expect(second.id).toBe('mine');
    expect(second.name).toBe('Mine');
  });

  test('does not mutate the draft or the preset', () => {
    const preset = presetOrThrow('zai');
    const draft = blankDraft();
    const draftSnapshot = structuredClone(draft);
    const presetSnapshot = structuredClone(preset);

    applyProviderPreset(draft, preset);

    expect(draft).toEqual(draftSnapshot);
    expect(preset).toEqual(presetSnapshot);
  });
});
