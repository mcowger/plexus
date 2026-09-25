import { z } from 'zod';

/**
 * Pre-configured provider presets for the Add Provider flow.
 *
 * Each preset pre-fills the endpoint map and optionally selects a pi-ai
 * builtin or explicit inline quirks. Auto-compat is opt-in for either source;
 * presets without a source leave request payloads unchanged.
 * Endpoint research lives with the project history; per-preset `notes`
 * capture only what an operator needs at setup time.
 *
 * URL convention: values are the base to store in `apiBaseUrl[type]` —
 * Plexus appends the per-type suffix (`/chat/completions`, `/messages`,
 * `/responses`, ...). Anthropic-compatible bases therefore include the
 * `/v1` segment (e.g. `.../anthropic/v1`), unlike SDK base URLs.
 */

/** Matches `{key}` template placeholders in endpoint URLs. */
const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

/**
 * https URLs, tolerating `{key}` template placeholders (validated
 * separately). Plain http is rejected: these endpoints receive operator API
 * keys, so presets must not suggest cleartext hosts.
 */
function isPresetUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const deTemplated = value.replace(PLACEHOLDER_PATTERN, 'x');
  return /^https:\/\//i.test(deTemplated);
}

const PresetTemplateVarSchema = z.object({
  /** Placeholder key, substituted as `{key}` wherever it appears in a URL. */
  key: z
    .string()
    .trim()
    .min(1)
    .refine((key) => !Object.hasOwn(Object.prototype, key), {
      message: 'templateVar key must not shadow an Object.prototype member',
    }),
  /** Label shown next to the setup-time input for this value. */
  label: z.string().trim().min(1),
  placeholder: z.string().optional(),
});

const ThinkingLevelMapSchema = z
  .object({
    off: z.string().nullable().optional(),
    minimal: z.string().nullable().optional(),
    low: z.string().nullable().optional(),
    medium: z.string().nullable().optional(),
    high: z.string().nullable().optional(),
    xhigh: z.string().nullable().optional(),
    max: z.string().nullable().optional(),
  })
  .strict();

const PiAiCompatSchema = z
  .object({
    thinkingFormat: z
      .enum([
        'zai',
        'qwen',
        'qwen-chat-template',
        'deepseek',
        'openrouter',
        'ant-ling',
        'together',
        'string-thinking',
      ])
      .optional(),
    supportsTemperature: z.boolean().optional(),
    maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
    forceAdaptiveThinking: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
  })
  .strict();

const PiAiQuirkTraitsSchema = z
  .object({
    reasoning: z.boolean().optional(),
    thinkingLevelMap: ThinkingLevelMapSchema.optional(),
    maxTokens: z.number().int().positive().optional(),
    compat: PiAiCompatSchema.optional(),
  })
  .strict();

const PiAiQuirkTargetSchema = <
  T extends
    | 'openai-completions'
    | 'openai-responses'
    | 'anthropic-messages'
    | 'google-generative-ai',
>(
  api: T
) =>
  PiAiQuirkTraitsSchema.extend({
    api: z.literal(api),
    models: z.record(z.string().min(1), PiAiQuirkTraitsSchema).optional(),
  });

/** Only protocols for which dispatch has explicit quirk projections. */
export const PiAiQuirksSchema = z
  .object({
    chat: PiAiQuirkTargetSchema('openai-completions').optional(),
    completions: PiAiQuirkTargetSchema('openai-completions').optional(),
    messages: PiAiQuirkTargetSchema('anthropic-messages').optional(),
    responses: PiAiQuirkTargetSchema('openai-responses').optional(),
    gemini: PiAiQuirkTargetSchema('google-generative-ai').optional(),
  })
  .strict()
  .refine((quirks) => Object.keys(quirks).length > 0, {
    message: 'piAiQuirks must define at least one target API',
  })
  .superRefine((quirks, ctx) => {
    for (const [target, definition] of Object.entries(quirks)) {
      if (!definition) continue;
      if (definition.thinkingLevelMap && definition.reasoning !== true) {
        ctx.addIssue({
          code: 'custom',
          path: [target, 'thinkingLevelMap'],
          message: 'thinkingLevelMap requires reasoning: true on this target',
        });
      }
      for (const [modelId, model] of Object.entries(definition.models ?? {})) {
        if (model.thinkingLevelMap && (model.reasoning ?? definition.reasoning) !== true) {
          ctx.addIssue({
            code: 'custom',
            path: [target, 'models', modelId, 'thinkingLevelMap'],
            message: 'thinkingLevelMap requires reasoning: true for this model',
          });
        }
      }
    }
  });

export type PiAiQuirks = z.infer<typeof PiAiQuirksSchema>;

export const ProviderPresetSchema = z
  .object({
    /** Stable preset key, e.g. `openai`, `moonshot-cn`. */
    id: z.string().trim().min(1),
    /** Display label for the preset picker. */
    name: z.string().trim().min(1),
    description: z.string().optional(),
    docsUrl: z
      .string()
      .url()
      .refine((value) => /^https:\/\//i.test(value), {
        message: 'docsUrl must be an https URL',
      })
      .optional(),
    /** Pre-filled provider id / display name (only applied to empty fields). */
    suggestedProviderId: z.string().trim().min(1),
    suggestedName: z.string().trim().min(1),
    /** Endpoint map applied verbatim to the provider draft's `apiBaseUrl`. */
    apiBaseUrl: z.record(
      z.string(),
      z.string().trim().min(1).refine(isPresetUrl, { message: 'endpoint must be an http(s) URL' })
    ),
    /** Subset of `apiBaseUrl` keys that are documented but not yet probed live. */
    experimentalApis: z.array(z.string().trim().min(1)).default([]),
    /** Setup-time values embedded as `{key}` placeholders in the URLs. */
    templateVars: z.array(PresetTemplateVarSchema).default([]),
    /** pi-ai builtin provider id used for catalog lookups and compat mapping. */
    piAiProvider: z.string().trim().min(1).optional(),
    /** Explicit quirks, keyed by configured target API type and upstream model ID. */
    piAiQuirks: PiAiQuirksSchema.optional(),
    autoCompat: z.boolean().default(false),
    /** Operator-facing caveats shown in the picker (auth quirks, docs gaps). */
    notes: z.string().optional(),
  })
  .refine((preset) => !(preset.piAiProvider && preset.piAiQuirks), {
    message: 'piAiProvider and piAiQuirks are mutually exclusive',
  })
  .refine((preset) => !preset.autoCompat || !!(preset.piAiProvider || preset.piAiQuirks), {
    message: 'autoCompat requires piAiProvider or piAiQuirks',
  })
  .refine(
    (preset) =>
      !preset.piAiQuirks ||
      Object.keys(preset.piAiQuirks).every((api) => Object.hasOwn(preset.apiBaseUrl, api)),
    { message: 'piAiQuirks targets must be present in apiBaseUrl' }
  )
  .refine((preset) => Object.keys(preset.apiBaseUrl).length > 0, {
    message: 'preset must define at least one endpoint',
  })
  .refine(
    (preset) => preset.experimentalApis.every((api) => Object.hasOwn(preset.apiBaseUrl, api)),
    {
      message: 'experimentalApis must be a subset of apiBaseUrl keys',
    }
  )
  .refine(
    (preset) =>
      preset.templateVars.every((variable) =>
        Object.values(preset.apiBaseUrl).some((url) => url.includes(`{${variable.key}}`))
      ),
    { message: 'every templateVar key must appear as {key} in at least one URL' }
  )
  .refine(
    (preset) => {
      const declared = new Set(preset.templateVars.map((variable) => variable.key));
      return Object.values(preset.apiBaseUrl).every((url) =>
        [...url.matchAll(PLACEHOLDER_PATTERN)].every(
          ([, key]) => key !== undefined && declared.has(key)
        )
      );
    },
    { message: 'every {placeholder} in apiBaseUrl must be declared in templateVars' }
  );

export type ProviderPresetTemplateVar = z.infer<typeof PresetTemplateVarSchema>;
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;

export function findProviderPreset(
  presets: ProviderPreset[],
  id: string
): ProviderPreset | undefined {
  return presets.find((preset) => preset.id === id);
}

/**
 * Substitute `{key}` template placeholders in an endpoint map. Values without
 * a matching entry are left intact so partially-filled drafts keep visible
 * placeholders instead of silently producing broken URLs.
 */
export function substitutePresetVars(
  urls: Record<string, string>,
  values: Record<string, string>
): Record<string, string> {
  const substituted: Record<string, string> = {};
  for (const [apiType, url] of Object.entries(urls)) {
    substituted[apiType] = url.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
      const raw = Object.hasOwn(values, key) ? values[key] : undefined;
      const value = typeof raw === 'string' ? raw.trim() : '';
      return value ? value : match;
    });
  }
  return substituted;
}

/**
 * Lists the `{placeholders}` still present in an endpoint map — used to warn
 * in the picker and to block saves until template values are filled in.
 */
export function findUnresolvedPresetVars(urls: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const url of Object.values(urls)) {
    if (typeof url !== 'string') continue;
    for (const [, key] of url.matchAll(PLACEHOLDER_PATTERN)) {
      if (key !== undefined) found.add(key);
    }
  }
  return [...found];
}

/** Minimal structural draft a preset can be applied to (the frontend Provider satisfies this). */
export interface ProviderPresetDraft {
  id: string;
  name: string;
  apiBaseUrl?: string | Record<string, string>;
  apiKey: string;
  oauthProvider?: string;
  type: string | string[];
  pi_ai_provider?: string;
  pi_ai_quirks?: PiAiQuirks;
  auto_compat?: boolean;
}

/**
 * Apply endpoints, quirk source and auto-compat to a provider draft. Switching
 * sources clears the alternative; id/name suggestions only replace blank or
 * previously suggested fields, and OAuth-mode leftovers are cleared.
 */
export function applyProviderPreset<T extends ProviderPresetDraft>(
  draft: T,
  preset: ProviderPreset,
  varValues: Record<string, string> = {},
  previousPreset?: ProviderPreset
): T {
  const idIsAutoFilled = !draft.id.trim() || draft.id === previousPreset?.suggestedProviderId;
  const nameIsAutoFilled = !draft.name.trim() || draft.name === previousPreset?.suggestedName;
  return {
    ...draft,
    id: idIsAutoFilled ? preset.suggestedProviderId : draft.id,
    name: nameIsAutoFilled ? preset.suggestedName : draft.name,
    apiBaseUrl: substitutePresetVars({ ...preset.apiBaseUrl }, varValues),
    apiKey: draft.apiKey === 'oauth' ? '' : draft.apiKey,
    oauthProvider: '',
    type: Object.keys(preset.apiBaseUrl),
    pi_ai_provider: preset.piAiProvider,
    pi_ai_quirks: preset.piAiQuirks ? structuredClone(preset.piAiQuirks) : undefined,
    auto_compat: preset.autoCompat,
  };
}
