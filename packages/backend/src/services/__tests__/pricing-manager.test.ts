import { describe, expect, test, beforeEach } from 'vitest';
import { PricingManager } from '../observability/pricing-manager';
import { ModelMetadataManager } from '../models/model-metadata-manager';
import path from 'path';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { calculateCosts } from '../../utils/calculate-costs';

const FIXTURES = path.join(__dirname, '../../utils/__tests__/fixtures');
const pricingFixture = path.join(FIXTURES, 'openrouter-models.json');
const metadataFixture = path.join(FIXTURES, 'openrouter-metadata-sample.json');

async function loadCatalog(openrouterSource: string): Promise<void> {
  await ModelMetadataManager.getInstance().loadAll({
    openrouter: openrouterSource,
    modelsDev: '/nonexistent',
    catwalk: '/nonexistent',
  });
}

describe('PricingManager - Model Search', () => {
  let pricingManager: PricingManager;

  beforeEach(async () => {
    ModelMetadataManager.resetForTesting();
    pricingManager = PricingManager.getInstance();
    await loadCatalog(pricingFixture);
  });

  test('should return all model slugs when no query provided', () => {
    const slugs = pricingManager.searchModelSlugs('');
    expect(slugs.length).toBeGreaterThan(0);
    expect(Array.isArray(slugs)).toBe(true);
  });

  test('should find models with substring match', () => {
    const slugs = pricingManager.searchModelSlugs('claude');
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every((slug) => slug.toLowerCase().includes('claude'))).toBe(true);
  });

  test('should find models with case-insensitive search', () => {
    const lowerCase = pricingManager.searchModelSlugs('claude');
    const upperCase = pricingManager.searchModelSlugs('CLAUDE');
    const mixedCase = pricingManager.searchModelSlugs('ClAuDe');

    expect(lowerCase).toEqual(upperCase);
    expect(lowerCase).toEqual(mixedCase);
  });

  test('should prioritize matches that start with query', () => {
    const slugs = pricingManager.searchModelSlugs('anthropic');

    // First result should start with "anthropic"
    expect(slugs.length).toBeGreaterThan(0);
    if (slugs.length > 0 && slugs[0]) {
      expect(slugs[0].toLowerCase().startsWith('anthropic')).toBe(true);
    }
  });

  test('should return empty array for non-matching query', () => {
    const slugs = pricingManager.searchModelSlugs('nonexistentmodel12345');
    expect(slugs).toEqual([]);
  });

  test('should find partial model name matches', () => {
    const slugs = pricingManager.searchModelSlugs('sonnet');
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every((slug) => slug.toLowerCase().includes('sonnet'))).toBe(true);
  });

  test('should return all slugs via getAllModelSlugs', () => {
    const allSlugs = pricingManager.getAllModelSlugs();
    expect(allSlugs.length).toBeGreaterThan(0);
    expect(Array.isArray(allSlugs)).toBe(true);
  });

  test('should handle special characters in search query', () => {
    const slugs = pricingManager.searchModelSlugs('claude-3.5');
    // Should not throw and should return results if matching models exist
    expect(Array.isArray(slugs)).toBe(true);
  });
});

describe('PricingManager - Shared Catalog', () => {
  beforeEach(async () => {
    ModelMetadataManager.resetForTesting();
    await loadCatalog(pricingFixture);
  });

  test('isInitialized reflects the metadata catalog state', () => {
    expect(PricingManager.getInstance().isInitialized()).toBe(true);

    ModelMetadataManager.resetForTesting();
    expect(PricingManager.getInstance().isInitialized()).toBe(false);
  });

  test('getPricing reads from the metadata catalog', () => {
    const pricing = PricingManager.getInstance().getPricing('anthropic/claude-3.5-sonnet');
    expect(pricing).toBeDefined();
    expect(pricing?.prompt).toBe('0.000003');
    expect(pricing?.completion).toBe('0.000015');
  });

  test('getPricing returns undefined for unknown slugs', () => {
    expect(PricingManager.getInstance().getPricing('nonexistent/model')).toBeUndefined();
  });

  test('getPricing treats negative (variable) OpenRouter pricing as unknown', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'plexus-pricing-'));
    const fixture = path.join(dir, 'openrouter-variable.json');
    writeFileSync(
      fixture,
      JSON.stringify({
        data: [
          { id: 'typesafe/jev-router', pricing: { prompt: '-1', completion: '-1' } },
          { id: 'openai/gpt-4', pricing: { prompt: '0.00003', completion: '0.00006' } },
        ],
      })
    );
    try {
      await loadCatalog(fixture);
      const pricingManager = PricingManager.getInstance();
      expect(pricingManager.getPricing('typesafe/jev-router')).toBeUndefined();
      expect(pricingManager.getPricing('openai/gpt-4')?.prompt).toBe('0.00003');

      const usage: Record<string, any> = { tokensInput: 2327, tokensOutput: 259 };
      calculateCosts(usage, { source: 'openrouter', slug: 'typesafe/jev-router' });
      expect(usage.costTotal).toBeUndefined();
      expect(usage.costSource).toBe('default');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('catalog refreshes are visible without reloading the PricingManager', async () => {
    const pricingManager = PricingManager.getInstance();

    // gpt-4.1-nano only exists in the metadata-sample fixture, not the pricing fixture
    expect(pricingManager.getPricing('openai/gpt-4.1-nano')).toBeUndefined();
    expect(pricingManager.searchModelSlugs('gpt-4.1-nano')).toEqual([]);

    // Simulate a scheduled/manual catalog refresh swapping in new data
    await loadCatalog(metadataFixture);

    expect(pricingManager.getPricing('openai/gpt-4.1-nano')).toBeDefined();
    expect(pricingManager.searchModelSlugs('gpt-4.1-nano')).toEqual(['openai/gpt-4.1-nano']);
  });
});
