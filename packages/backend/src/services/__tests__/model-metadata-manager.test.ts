import { describe, expect, test, beforeAll, afterEach } from 'bun:test';
import path from 'path';
import { ModelMetadataManager } from '../model-metadata-manager';

const FIXTURES = path.join(__dirname, '../../utils/__tests__/fixtures');

const openrouterFixture = path.join(FIXTURES, 'openrouter-metadata-sample.json');
const modelsDevFixture = path.join(FIXTURES, 'models-dev-sample.json');
const catwalkFixture = path.join(FIXTURES, 'catwalk-sample.json');

// Reset the singleton between test suites so each describe block gets a fresh instance
afterEach(() => {
  ModelMetadataManager.resetForTesting();
});

// ─── OpenRouter ──────────────────────────────────────────────────

describe('ModelMetadataManager – OpenRouter source', () => {
  let mgr: ModelMetadataManager;

  beforeAll(async () => {
    ModelMetadataManager.resetForTesting();
    mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterFixture,
      // skip other sources so maps stay empty
      modelsDev: '/dev/null-nonexistent',
      catwalk: '/dev/null-nonexistent',
    });
  });

  test('isInitialized returns true for openrouter after load', () => {
    expect(mgr.isInitialized('openrouter')).toBe(true);
  });

  test('isInitialized returns false for unloaded sources', () => {
    expect(mgr.isInitialized('models.dev')).toBe(false);
    expect(mgr.isInitialized('catwalk')).toBe(false);
  });

  test('getMetadata returns correct model for openrouter', () => {
    const meta = mgr.getMetadata('openrouter', 'anthropic/claude-3.5-sonnet');
    expect(meta).toBeDefined();
    expect(meta!.id).toBe('anthropic/claude-3.5-sonnet');
    expect(meta!.name).toBe('Anthropic: Claude 3.5 Sonnet');
    expect(meta!.context_length).toBe(200000);
    expect(meta!.description).toContain('Claude 3.5 Sonnet');
  });

  test('getMetadata returns pricing as per-token strings', () => {
    const meta = mgr.getMetadata('openrouter', 'anthropic/claude-3.5-sonnet');
    expect(meta!.pricing?.prompt).toBe('0.000003');
    expect(meta!.pricing?.completion).toBe('0.000015');
    expect(meta!.pricing?.input_cache_read).toBe('0.0000003');
  });

  test('getMetadata returns architecture with modalities', () => {
    const meta = mgr.getMetadata('openrouter', 'openai/gpt-4.1-nano');
    expect(meta!.architecture?.input_modalities).toContain('text');
    expect(meta!.architecture?.input_modalities).toContain('image');
    expect(meta!.architecture?.output_modalities).toContain('text');
  });

  test('getMetadata returns supported_parameters', () => {
    const meta = mgr.getMetadata('openrouter', 'openai/gpt-4.1-nano');
    expect(meta!.supported_parameters).toContain('temperature');
    expect(meta!.supported_parameters).toContain('tools');
  });

  test('getMetadata returns top_provider', () => {
    const meta = mgr.getMetadata('openrouter', 'openai/gpt-4.1-nano');
    expect(meta!.top_provider?.context_length).toBe(1000000);
    expect(meta!.top_provider?.max_completion_tokens).toBe(32768);
  });

  test('getMetadata returns undefined for unknown path', () => {
    const meta = mgr.getMetadata('openrouter', 'nonexistent/model');
    expect(meta).toBeUndefined();
  });

  test('getMetadata returns undefined when querying wrong source', () => {
    // openrouter path shouldn't be found in models.dev map
    const meta = mgr.getMetadata('models.dev', 'anthropic/claude-3.5-sonnet');
    expect(meta).toBeUndefined();
  });

  test('search returns results matching substring', () => {
    const results = mgr.search('openrouter', 'claude');
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (r) => r.id.toLowerCase().includes('claude') || r.name.toLowerCase().includes('claude')
      )
    ).toBe(true);
  });

  test('search is case-insensitive', () => {
    const lower = mgr.search('openrouter', 'claude');
    const upper = mgr.search('openrouter', 'CLAUDE');
    expect(lower.map((r) => r.id).sort()).toEqual(upper.map((r) => r.id).sort());
  });

  test('search with empty query returns all models', () => {
    const all = mgr.search('openrouter', '');
    expect(all.length).toBe(mgr.getAllIds('openrouter').length);
  });

  test('search returns empty array for no matches', () => {
    const results = mgr.search('openrouter', 'zznotarealmodel9999');
    expect(results).toEqual([]);
  });

  test('search respects limit', () => {
    const results = mgr.search('openrouter', '', 1);
    expect(results.length).toBe(1);
  });

  test('getAllIds returns all loaded model paths', () => {
    const ids = mgr.getAllIds('openrouter');
    expect(ids).toContain('anthropic/claude-3.5-sonnet');
    expect(ids).toContain('openai/gpt-4.1-nano');
    expect(ids).toContain('google/gemini-pro');
  });
});

// ─── models.dev ───────────────────────────────────

describe('ModelMetadataManager – models.dev source', () => {
  let mgr: ModelMetadataManager;

  beforeAll(async () => {
    ModelMetadataManager.resetForTesting();
    mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: '/dev/null-nonexistent',
      modelsDev: modelsDevFixture,
      catwalk: '/dev/null-nonexistent',
    });
  });

  test('isInitialized returns true for models.dev after load', () => {
    expect(mgr.isInitialized('models.dev')).toBe(true);
  });

  test('getMetadata returns correct model using dot-notation path', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta).toBeDefined();
    expect(meta!.id).toBe('anthropic.claude-3-5-haiku-20241022');
    expect(meta!.name).toBe('Claude Haiku 3.5');
    expect(meta!.context_length).toBe(200000);
  });

  test('getMetadata normalizes cost: input 0.8 $/M → "0.0000008" $/token', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.pricing?.prompt).toBe(String(0.8 / 1_000_000));
    expect(meta!.pricing?.completion).toBe(String(4 / 1_000_000));
  });

  test('getMetadata normalizes cache_read pricing', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.pricing?.input_cache_read).toBe(String(0.08 / 1_000_000));
  });

  test('getMetadata includes modalities from models.dev', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.architecture?.input_modalities).toContain('text');
    expect(meta!.architecture?.input_modalities).toContain('image');
    expect(meta!.architecture?.output_modalities).toContain('text');
  });

  test('getMetadata infers supported_parameters from capabilities', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    // tool_call=true → tools and tool_choice
    expect(meta!.supported_parameters).toContain('tools');
    expect(meta!.supported_parameters).toContain('tool_choice');
    // temperature=true → temperature
    expect(meta!.supported_parameters).toContain('temperature');
    // reasoning=false → no reasoning param
    expect(meta!.supported_parameters).not.toContain('reasoning');
  });

  test('getMetadata includes reasoning param for models with reasoning=true', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-opus-4-20250514');
    expect(meta!.supported_parameters).toContain('reasoning');
  });

  test('getMetadata top_provider has context and output limits', () => {
    const meta = mgr.getMetadata('models.dev', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.top_provider?.max_completion_tokens).toBe(8192);
    expect(meta!.top_provider?.context_length).toBe(200000);
  });

  test('search works with models.dev dot-notation IDs', () => {
    const results = mgr.search('models.dev', 'anthropic');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.id.startsWith('anthropic.'))).toBe(true);
  });

  test('getAllIds includes all models across providers', () => {
    const ids = mgr.getAllIds('models.dev');
    expect(ids).toContain('anthropic.claude-3-5-haiku-20241022');
    expect(ids).toContain('anthropic.claude-opus-4-20250514');
    expect(ids).toContain('openai.gpt-4.1-nano');
  });
});

// ─── Catwalk ─────────────────────────────────────────────

describe('ModelMetadataManager – Catwalk source', () => {
  let mgr: ModelMetadataManager;

  beforeAll(async () => {
    ModelMetadataManager.resetForTesting();
    mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: '/dev/null-nonexistent',
      modelsDev: '/dev/null-nonexistent',
      catwalk: catwalkFixture,
    });
  });

  test('isInitialized returns true for catwalk after load', () => {
    expect(mgr.isInitialized('catwalk')).toBe(true);
  });

  test('getMetadata returns correct model using dot-notation path', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta).toBeDefined();
    expect(meta!.id).toBe('anthropic.claude-3-5-haiku-20241022');
    expect(meta!.name).toBe('Claude 3.5 Haiku');
    expect(meta!.context_length).toBe(200000);
  });

  test('getMetadata normalizes cost: 0.8 $/M → "0.0000008" $/token', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.pricing?.prompt).toBe(String(0.8 / 1_000_000));
    expect(meta!.pricing?.completion).toBe(String(4 / 1_000_000));
  });

  test('getMetadata normalizes cached pricing from cost_per_1m_in_cached', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.pricing?.input_cache_read).toBe(String(1 / 1_000_000));
  });

  test('getMetadata includes text in input_modalities', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.architecture?.input_modalities).toContain('text');
  });

  test('getMetadata adds image to modalities when supports_attachments=true', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.architecture?.input_modalities).toContain('image');
  });

  test('getMetadata adds reasoning to supported_parameters when can_reason=true', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-opus-4-20250514');
    expect(meta!.supported_parameters).toContain('reasoning');
  });

  test('getMetadata does NOT add reasoning when can_reason=false', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.supported_parameters).not.toContain('reasoning');
  });

  test('getMetadata top_provider reflects context and max_tokens', () => {
    const meta = mgr.getMetadata('catwalk', 'anthropic.claude-3-5-haiku-20241022');
    expect(meta!.top_provider?.context_length).toBe(200000);
    expect(meta!.top_provider?.max_completion_tokens).toBe(5000);
  });

  test('search finds models by provider prefix', () => {
    const results = mgr.search('catwalk', 'openai');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.id.startsWith('openai.'))).toBe(true);
  });

  test('getAllIds includes models from all catwalk providers', () => {
    const ids = mgr.getAllIds('catwalk');
    expect(ids).toContain('anthropic.claude-3-5-haiku-20241022');
    expect(ids).toContain('anthropic.claude-opus-4-20250514');
    expect(ids).toContain('openai.gpt-4.1-mini');
  });
});

// ─── Error handling ─────────────────────────────────────────

describe('ModelMetadataManager – error handling', () => {
  test('loadAll does not throw when sources are missing files', async () => {
    ModelMetadataManager.resetForTesting();
    const mgr = ModelMetadataManager.getInstance();
    // Should not throw — errors are logged and gracefully swallowed
    await expect(
      mgr.loadAll({
        openrouter: '/nonexistent/path/openrouter.json',
        modelsDev: '/nonexistent/path/models-dev.json',
        catwalk: '/nonexistent/path/catwalk.json',
      })
    ).resolves.toBeUndefined();
  });

  test('isInitialized returns false when load failed', async () => {
    ModelMetadataManager.resetForTesting();
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: '/nonexistent/path.json',
      modelsDev: '/nonexistent/path.json',
      catwalk: '/nonexistent/path.json',
    });
    expect(mgr.isInitialized('openrouter')).toBe(false);
    expect(mgr.isInitialized('models.dev')).toBe(false);
    expect(mgr.isInitialized('catwalk')).toBe(false);
  });

  test('search returns empty array when source not initialized', async () => {
    ModelMetadataManager.resetForTesting();
    const mgr = ModelMetadataManager.getInstance();
    const results = mgr.search('openrouter', 'claude');
    expect(results).toEqual([]);
  });

  test('getMetadata returns undefined when source not initialized', async () => {
    ModelMetadataManager.resetForTesting();
    const mgr = ModelMetadataManager.getInstance();
    const meta = mgr.getMetadata('openrouter', 'anthropic/claude-3.5-sonnet');
    expect(meta).toBeUndefined();
  });
});

// ─── Singleton ───────────────────────────────────────────────────

describe('ModelMetadataManager – singleton', () => {
  test('getInstance returns the same instance', () => {
    ModelMetadataManager.resetForTesting();
    const a = ModelMetadataManager.getInstance();
    const b = ModelMetadataManager.getInstance();
    expect(a).toBe(b);
  });

  test('resetForTesting creates a fresh instance', async () => {
    ModelMetadataManager.resetForTesting();
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({ openrouter: openrouterFixture });
    expect(mgr.isInitialized('openrouter')).toBe(true);

    ModelMetadataManager.resetForTesting();
    const mgr2 = ModelMetadataManager.getInstance();
    expect(mgr2.isInitialized('openrouter')).toBe(false);
    expect(mgr2).not.toBe(mgr);
  });
});
