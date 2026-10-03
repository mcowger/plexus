import { z } from 'zod';
import {
  ProviderPresetSchema,
  type ProviderPreset,
} from '../../packages/shared/src/provider-presets';

type Tier = 'auto' | 'standard' | 'flex' | 'priority' | 'ultrafast';
interface Catalog {
  presets: ProviderPreset[];
  [key: string]: unknown;
}

const modeSchema = z
  .object({
    provider: z
      .object({
        body: z.record(z.string(), z.unknown()).optional(),
        headers: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();
const providerSchema = z
  .object({
    models: z.record(
      z.string(),
      z
        .object({
          experimental: z.object({ modes: z.record(z.string(), modeSchema).optional() }).optional(),
          provider: z.object({ shape: z.string().optional() }).passthrough().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();
const sourceSchema = z.object({ openai: providerSchema, anthropic: providerSchema }).passthrough();

const nativeTiers: Record<string, Tier> = {
  auto: 'auto',
  default: 'standard',
  standard: 'standard',
  flex: 'flex',
  priority: 'priority',
  ultrafast: 'ultrafast',
};

const anthropicTiers: Record<string, Tier> = { fast: 'priority', standard: 'standard' };

/** Backfill positive declarations only. Never remove or replace a configured value. */
export function backfillServiceTiers(rawCatalog: unknown, rawSource: unknown) {
  const source = sourceSchema.parse(rawSource);
  const catalogSchema = z.object({ presets: z.array(ProviderPresetSchema) }).passthrough();
  // Validate without applying schema defaults to the file we will write.
  catalogSchema.parse(rawCatalog);
  const original = rawCatalog as Catalog;
  const catalog = structuredClone(original);
  const changes: string[] = [];
  const warnings: string[] = [];

  for (const providerId of ['openai', 'anthropic'] as const) {
    const preset = catalog.presets.find((entry) => entry.id === providerId);
    if (!preset) throw new Error(`Missing ${providerId} preset`);
    const originalPreset = original.presets.find((entry) => entry.id === providerId)!;
    const addedTiers = new Map<string, string>();
    for (const [modelId, model] of Object.entries(source[providerId].models).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      for (const [modeName, mode] of Object.entries(model.experimental?.modes ?? {})) {
        const body = mode.provider?.body;
        if (!body || (!('service_tier' in body) && !('speed' in body))) continue;
        const native = providerId === 'openai' ? body.service_tier : body.speed;
        const tierTable = providerId === 'openai' ? nativeTiers : anthropicTiers;
        const tier = typeof native === 'string' ? tierTable[native] : undefined;
        const expectedHeaders =
          providerId === 'anthropic' && native === 'fast'
            ? { 'anthropic-beta': 'fast-mode-2026-02-01' }
            : {};
        const headers = mode.provider?.headers ?? {};
        const expectedBodyKey = providerId === 'openai' ? 'service_tier' : 'speed';
        if (
          !tier ||
          Object.keys(body).some((key) => key !== expectedBodyKey) ||
          Object.entries(headers).some(
            ([key, value]) => expectedHeaders[key as keyof typeof expectedHeaders] !== value
          ) ||
          (providerId === 'anthropic' &&
            native === 'fast' &&
            headers['anthropic-beta'] !== expectedHeaders['anthropic-beta'])
        ) {
          warnings.push(`${providerId}/${modelId}/${modeName}: unsupported tier recipe; skipped`);
          continue;
        }
        const targets =
          providerId === 'anthropic' ? (['messages'] as const) : (['responses', 'chat'] as const);
        for (const api of targets) {
          const target = preset.piAiQuirks?.[api];
          if (!target || !preset.apiBaseUrl[api]) {
            warnings.push(`${providerId}/${modelId}/${api}: missing configured target; skipped`);
            continue;
          }
          // models.dev modes are model-level, not endpoint-specific. Do not
          // invent new Chat support; preserve existing endpoint restrictions.
          if (
            api === 'chat' &&
            (tier === 'ultrafast' ||
              !target.models?.[modelId] ||
              model.provider?.shape === 'responses')
          )
            continue;
          if (api === 'responses' && model.provider?.shape === 'completions') continue;
          const format = providerId === 'anthropic' ? 'anthropic-speed' : 'service-tier';
          const modelTraits = target.models?.[modelId];
          const configuredFormat =
            modelTraits?.compat?.serviceTierFormat ?? target.compat?.serviceTierFormat;
          if (configuredFormat !== undefined && configuredFormat !== format) {
            warnings.push(`${providerId}/${modelId}/${api}: conflicting tier format; skipped`);
            continue;
          }
          const addedKey = JSON.stringify([api, modelId, tier]);
          const added = addedTiers.get(addedKey);
          if (added !== undefined) {
            if (added !== native)
              warnings.push(
                `${providerId}/${modelId}/${api}/${tier}: conflicting models.dev modes (${added} vs ${String(native)}); kept first`
              );
            continue;
          }
          const existing =
            originalPreset.piAiQuirks?.[api]?.models?.[modelId]?.serviceTierMap?.[tier];
          if (existing !== undefined) {
            if (existing !== native)
              warnings.push(
                `${providerId}/${modelId}/${api}/${tier}: configured ${JSON.stringify(existing)} conflicts with ${JSON.stringify(native)}; preserved`
              );
            continue;
          }
          // A model map replaces the common map. Seed a new override with the
          // common map so auto/standard and any explicit restrictions survive.
          const map = modelTraits?.serviceTierMap ?? { ...target.serviceTierMap };
          const inherited = map[tier];
          if (inherited === native) continue;
          if (typeof inherited === 'string') {
            warnings.push(
              `${providerId}/${modelId}/${api}/${tier}: inherited ${JSON.stringify(inherited)} conflicts with ${JSON.stringify(native)}; preserved`
            );
            continue;
          }
          map[tier] = native as string;
          addedTiers.set(addedKey, native as string);
          target.models ??= {};
          target.models[modelId] = { ...modelTraits, serviceTierMap: map };
          changes.push(`${providerId}/${modelId}/${api}: ${tier} -> ${native}`);
        }
      }
    }
  }
  catalogSchema.parse(catalog);
  return { catalog, changes, warnings };
}
