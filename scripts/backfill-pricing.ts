#!/usr/bin/env bun
/**
 * Backfill OpenRouter pricing for all models under a given provider.
 *
 * Usage:
 *   ADMIN_KEY=xxx bun run scripts/backfill-pricing.ts <provider-slug> [--dry-run] [--yes]
 *
 * What it does:
 *   1. Reads the provider config from Plexus (GET /v0/management/providers/{slug})
 *   2. Extracts model IDs from the provider's `models` field
 *   3. Fetches the OpenRouter model catalog (https://openrouter.ai/api/v1/models)
 *   4. Matches each local model ID to an OpenRouter slug (exact, then substring/fuzzy)
 *   5. Confirms matches with the user
 *   6. Deep-merges pricing into the existing models config
 *   7. PATCHes the provider with the full updated `models` object
 *
 * Flags:
 *   --dry-run   Show matches but don't write anything back
 *   --yes       Skip confirmation prompt (accept all matches)
 *
 * Environment:
 *   ADMIN_KEY   (required) Plexus admin key
 *   PLEXUS_BASE (optional)  Plexus base URL, defaults to http://localhost:4000
 */

const PLEXUS_BASE = process.env.PLEXUS_BASE ?? 'http://localhost:4000';
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  console.error('ERROR: ADMIN_KEY env var is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipConfirm = args.includes('--yes');
const forceOverwrite = args.includes('--force');
const positionalArgs = args.filter((a) => !a.startsWith('--'));

if (positionalArgs.length < 1) {
  console.error(
    'Usage: ADMIN_KEY=xxx bun run scripts/backfill-pricing.ts <provider-slug> [--dry-run] [--yes] [--force]'
  );
  process.exit(1);
}

const providerSlug = positionalArgs[0];

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
    internal_reasoning?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

interface Match {
  localModel: string;
  orSlug: string;
  orName: string;
  method: 'exact' | 'substring' | 'fuzzy';
  promptPrice?: string;
  completionPrice?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}\n${body.slice(0, 500)}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `GET ${url} → response is not JSON (status ${res.status}, content-type ${res.headers.get('content-type')})\nFirst 500 chars:\n${text.slice(0, 500)}`
    );
  }
}

/** Read a single line from stdin for confirmation. */
function askUser(prompt: string): Promise<string> {
  const { createInterface } = require('readline') as typeof import('readline');
  const iface = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    iface.question(prompt, (answer: string) => {
      iface.close();
      resolve(answer.trim());
    });
  });
}

/** Normalize a model name for comparison: lowercase, strip common separators. */
function normalize(id: string): string {
  return id
    .toLowerCase()
    .replace(/[:\-_.]/g, '')
    .replace(/latest$/, '')
    .replace(/^\//, '');
}

/**
 * Attempt to match a local model ID against OpenRouter slugs.
 * Strategy:
 *   1. Exact match (case-insensitive)
 *   2. Suffix match — local ID equals the model part of "provider/model"
 *   3. Substring containment
 *   4. Token-overlap fuzzy scoring
 */
function findMatch(localId: string, orModels: Map<string, OpenRouterModel>): Match | null {
  const localLower = localId.toLowerCase();

  // 1. Exact match
  if (orModels.has(localLower)) {
    const m = orModels.get(localLower)!;
    return {
      localModel: localId,
      orSlug: m.id,
      orName: m.name ?? m.id,
      method: 'exact',
      promptPrice: m.pricing?.prompt,
      completionPrice: m.pricing?.completion,
    };
  }

  // 2. Suffix match: "sonar-pro" matches "perplexity/sonar-pro"
  const suffixCandidates: Array<{ slug: string; model: OpenRouterModel }> = [];
  for (const [slug, model] of orModels) {
    const parts = slug.split('/');
    const modelPart = parts.length > 1 ? parts.slice(1).join('/') : slug;
    if (modelPart.toLowerCase() === localLower) {
      suffixCandidates.push({ slug, model });
    }
  }
  if (suffixCandidates.length === 1) {
    const { slug, model } = suffixCandidates[0];
    return {
      localModel: localId,
      orSlug: slug,
      orName: model.name ?? slug,
      method: 'exact',
      promptPrice: model.pricing?.prompt,
      completionPrice: model.pricing?.completion,
    };
  }

  // 3. Substring containment
  const localNorm = normalize(localId);
  const substringCandidates: Array<{ slug: string; model: OpenRouterModel; score: number }> = [];
  for (const [slug, model] of orModels) {
    const slugNorm = normalize(slug);
    if (slugNorm.includes(localNorm) || localNorm.includes(slugNorm)) {
      const overlapLen = Math.min(slugNorm.length, localNorm.length);
      // Penalize bare slugs (no "/") — they're too generic
      const genericPenalty = slug.includes('/') ? 0 : 100;
      substringCandidates.push({ slug, model, score: overlapLen - genericPenalty });
    }
  }
  if (substringCandidates.length > 0) {
    substringCandidates.sort((a, b) => b.score - a.score);
    const best = substringCandidates[0];
    const secondBest = substringCandidates[1];
    if (!secondBest || secondBest.score < best.score * 0.7) {
      return {
        localModel: localId,
        orSlug: best.slug,
        orName: best.model.name ?? best.slug,
        method: 'substring',
        promptPrice: best.model.pricing?.prompt,
        completionPrice: best.model.pricing?.completion,
      };
    }
    // Ambiguous — fall through to fuzzy
  }

  // 4. Token-overlap fuzzy matching
  const localTokens = new Set(localLower.split(/[:\-_/.]+/).filter(Boolean));
  let bestFuzzy: { slug: string; model: OpenRouterModel; score: number } | null = null;

  for (const [slug, model] of orModels) {
    const slugTokens = new Set(
      slug
        .toLowerCase()
        .split(/[:\-_/.]+/)
        .filter(Boolean)
    );
    let overlap = 0;
    for (const t of localTokens) {
      if (slugTokens.has(t)) overlap++;
    }
    const score = overlap / Math.max(localTokens.size, slugTokens.size);
    if (score >= 0.5 && (!bestFuzzy || score > bestFuzzy.score)) {
      bestFuzzy = { slug, model, score };
    }
  }

  if (bestFuzzy && bestFuzzy.score >= 0.5) {
    return {
      localModel: localId,
      orSlug: bestFuzzy.slug,
      orName: bestFuzzy.model.name ?? bestFuzzy.slug,
      method: 'fuzzy',
      promptPrice: bestFuzzy.model.pricing?.prompt,
      completionPrice: bestFuzzy.model.pricing?.completion,
    };
  }

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔎 Backfill pricing for provider: ${providerSlug}`);
  if (dryRun) console.log('   (dry-run mode — no writes)\n');

  // 1. Fetch provider config
  console.log('Fetching provider config from Plexus...');
  const provider = await fetchJSON<Record<string, unknown>>(
    `${PLEXUS_BASE}/v0/management/providers/${providerSlug}`,
    { 'x-admin-key': ADMIN_KEY }
  );

  const modelsField = provider.models;
  if (!modelsField) {
    console.error("Provider has no 'models' field.");
    process.exit(1);
  }

  // Extract model IDs
  let localModels: string[];
  let modelsMap: Record<string, Record<string, unknown>> | null = null;

  if (Array.isArray(modelsField)) {
    localModels = modelsField as string[];
  } else if (typeof modelsField === 'object') {
    modelsMap = modelsField as Record<string, Record<string, unknown>>;
    localModels = Object.keys(modelsMap);
  } else {
    console.error('Unexpected models field type:', typeof modelsField);
    process.exit(1);
  }

  // Identify models with real vs placeholder pricing
  const modelsWithPlaceholderPricing = new Set<string>();
  const modelsWithRealPricing = new Set<string>();

  if (modelsMap && !forceOverwrite) {
    for (const [id, cfg] of Object.entries(modelsMap)) {
      if (cfg?.pricing) {
        const p = cfg.pricing as Record<string, unknown>;
        // Detect placeholder pricing: source=simple with input=0 and output=0
        const isPlaceholder =
          p.source === 'simple' &&
          (p.input === 0 || p.input === '0') &&
          (p.output === 0 || p.output === '0');
        if (isPlaceholder) {
          modelsWithPlaceholderPricing.add(id);
        } else {
          modelsWithRealPricing.add(id);
        }
      }
    }
  }

  // With --force, all models are candidates; otherwise skip those with real pricing
  const allModelsToProcess = forceOverwrite
    ? [...localModels]
    : localModels
        .filter((id) => !modelsWithRealPricing.has(id) && !modelsWithPlaceholderPricing.has(id))
        .concat([...modelsWithPlaceholderPricing]);

  if (forceOverwrite) {
    console.log(
      `   ⚠️  --force: presenting all ${localModels.length} model(s), including those with existing pricing`
    );
  } else {
    if (modelsWithRealPricing.size > 0) {
      console.log(
        `   Skipping ${modelsWithRealPricing.size} model(s) with real pricing: ${[...modelsWithRealPricing].join(', ')}`
      );
    }
    if (modelsWithPlaceholderPricing.size > 0) {
      console.log(
        `   Found ${modelsWithPlaceholderPricing.size} model(s) with placeholder (zero) pricing to overwrite: ${[...modelsWithPlaceholderPricing].join(', ')}`
      );
    }
  }
  const modelsWithoutPricing = forceOverwrite
    ? []
    : localModels.filter(
        (id) => !modelsWithRealPricing.has(id) && !modelsWithPlaceholderPricing.has(id)
      );
  if (!forceOverwrite && modelsWithoutPricing.length > 0) {
    console.log(
      `   Found ${modelsWithoutPricing.length} model(s) without pricing: ${modelsWithoutPricing.join(', ')}`
    );
  }
  if (allModelsToProcess.length === 0) {
    console.log('No models need pricing. Done.');
    return;
  }

  console.log(`   Total models to process: ${allModelsToProcess.length}\n`);

  // 2. Fetch OpenRouter catalog
  console.log('Fetching OpenRouter model catalog...');
  const orData = await fetchJSON<{ data: OpenRouterModel[] }>(
    'https://openrouter.ai/api/v1/models'
  );
  const orModels = new Map<string, OpenRouterModel>();
  for (const m of orData.data) {
    orModels.set(m.id.toLowerCase(), m);
  }
  console.log(`   Loaded ${orModels.size} OpenRouter models\n`);

  // 3. Match each local model to an OR slug
  const matches: Match[] = [];
  const unmatched: string[] = [];

  for (const localId of allModelsToProcess) {
    const match = findMatch(localId, orModels);
    if (match) {
      matches.push(match);
    } else {
      unmatched.push(localId);
    }
  }

  // 4. Display results
  if (matches.length > 0) {
    console.log(
      '┌──────────────────────────────────────────────────────────────────────────────────┐'
    );
    console.log(
      '│ Matched models                                                                   │'
    );
    console.log(
      '├─────────────────────┬────────────────────────────┬──────────┬─────────────────────┤'
    );
    console.log(
      '│ Local Model         │ OpenRouter Slug            │ Method   │ Price $/M (in→out)  │'
    );
    console.log(
      '├─────────────────────┼────────────────────────────┼──────────┼─────────────────────┤'
    );

    for (const m of matches) {
      const prompt =
        m.promptPrice && m.promptPrice !== '0'
          ? `${(parseFloat(m.promptPrice) * 1_000_000).toFixed(2)}`
          : m.promptPrice === '0'
            ? 'free'
            : '—';
      const completion =
        m.completionPrice && m.completionPrice !== '0'
          ? `${(parseFloat(m.completionPrice) * 1_000_000).toFixed(2)}`
          : m.completionPrice === '0'
            ? 'free'
            : '—';
      const priceStr = `${prompt} → ${completion}`;
      console.log(
        `│ ${m.localModel.padEnd(19)} │ ${m.orSlug.padEnd(26)} │ ${m.method.padEnd(8)} │ ${priceStr.padEnd(19)} │`
      );
    }
    console.log(
      '└─────────────────────┴────────────────────────────┴──────────┴─────────────────────┘'
    );
  }

  if (unmatched.length > 0) {
    console.log(`\n⚠️  Unmatched models (${unmatched.length}): ${unmatched.join(', ')}`);
    console.log("   You'll need to set pricing for these manually.\n");
  }

  if (matches.length === 0) {
    console.log('No matches found. Nothing to do.');
    return;
  }

  // 5. Confirm each match individually
  const confirmed: Match[] = [];

  if (skipConfirm && !dryRun) {
    confirmed.push(...matches);
  } else {
    console.log('\nConfirm each match:\n');
    console.log('  y / Enter  = accept this match');
    console.log("  n          = reject this match (won't set pricing)");
    console.log("  s          = skip for now (don't set pricing, you'll do it manually)\n");

    for (const m of matches) {
      const prompt =
        m.promptPrice && m.promptPrice !== '0'
          ? `$${(parseFloat(m.promptPrice) * 1_000_000).toFixed(2)}`
          : m.promptPrice === '0'
            ? 'free'
            : '—';
      const completion =
        m.completionPrice && m.completionPrice !== '0'
          ? `$${(parseFloat(m.completionPrice) * 1_000_000).toFixed(2)}`
          : m.completionPrice === '0'
            ? 'free'
            : '—';

      const answer = await askUser(
        `  ${m.localModel} → ${m.orSlug}  (${m.method}, ${prompt}/${completion})  [Y/n/s] `
      );

      if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
        console.log(`    ❌ Rejected`);
      } else if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'skip') {
        console.log(`    ⏭️  Skipped`);
      } else {
        confirmed.push(m);
        console.log(`    ✅ Accepted`);
      }
    }
  }

  if (confirmed.length === 0) {
    console.log('\nNo matches confirmed. Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log(`\nDry run — would apply pricing for ${confirmed.length} confirmed model(s):`);
    for (const m of confirmed) {
      console.log(`  ${m.localModel} → { source: "openrouter", slug: "${m.orSlug}" }`);
    }
    return;
  }

  // 6. Build the updated `models` object by deep-merging pricing into existing config
  console.log(`\nApplying pricing to ${confirmed.length} confirmed model(s)...`);

  // Start from the current full models config (or {} if it was a string array)
  const updatedModels: Record<string, Record<string, unknown>> = modelsMap
    ? structuredClone(modelsMap)
    : {};

  // If models was a string array, convert to object map
  if (!modelsMap && Array.isArray(modelsField)) {
    for (const id of modelsField as string[]) {
      updatedModels[id] = updatedModels[id] ?? {};
    }
  }

  // Merge pricing into each confirmed model
  for (const m of confirmed) {
    if (!updatedModels[m.localModel]) {
      updatedModels[m.localModel] = {};
    }
    updatedModels[m.localModel] = {
      ...updatedModels[m.localModel],
      pricing: { source: 'openrouter', slug: m.orSlug },
    };
  }

  // PATCH the provider with the full merged models field
  // (The PATCH handler does a shallow merge, so we must send the complete models object
  // to avoid losing existing model config entries.)
  const patchBody = { models: updatedModels };

  const res = await fetch(`${PLEXUS_BASE}/v0/management/providers/${providerSlug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify(patchBody),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`PATCH failed: ${res.status} ${res.statusText}\n${body}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log('✅ Pricing backfilled successfully!');
  console.log(`   Provider: ${providerSlug}`);
  console.log(`   Models updated: ${confirmed.length}`);
  const skipped = matches.filter((m) => !confirmed.includes(m));
  if (skipped.length > 0) {
    console.log(
      `   Skipped by user: ${skipped.length} (${skipped.map((m) => m.localModel).join(', ')})`
    );
  }
  if (unmatched.length > 0) {
    console.log(`   Unmatched models: ${unmatched.length} (${unmatched.join(', ')})`);
  }
  console.log();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
