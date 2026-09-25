# Provider preset definitions plan

Provider presets need a choice of quirk source: link to a real pi-ai provider, declare pi-ai-style quirks inline, or declare neither. Model discovery and canonical model-listing URLs are separate work and are out of scope here.

This is an implementation plan, not a description of behavior available today. It does not add or revise any provider preset. In particular, provider-specific additions can happen after the contract and runtime support are in place.

This slice does not add a model-listing URL, change Fetch Models or autosync, or interrogate provider capabilities. Inline model IDs below refer to models already configured by an operator; they are not discovered by this feature.

## Current behavior and the gap

- [`packages/backend/data/provider-presets.json`](packages/backend/data/provider-presets.json) contains the catalog. [`ProviderPresetSchema`](packages/shared/src/provider-presets.ts) currently requires `piAiProvider` and `autoCompat` for every entry. [`applyProviderPreset`](packages/shared/src/provider-presets.ts) copies the endpoint map and those two fields into a provider draft.
- The backend serves a validated remote catalog first, falling back to the local or embedded copy when the remote is unavailable or invalid ([`provider-presets.ts`](packages/backend/src/services/provider-presets.ts)). The browser gets it through `GET /v0/management/provider-presets`.
- `pi_ai_provider` currently means a **real pi-ai catalog provider**. The runtime's registry-based compatibility step requires both that provider ID and a per-model `pi_ai_model_id`; if either is missing or unresolved, it skips the rewrite ([`applyRegistryAutoCompat`](packages/backend/src/services/dispatch/dispatcher-auto-compat.ts)). Selecting a preset does not itself assign model IDs. A provider without a pi-ai definition should not have to claim another provider's ID.
- No published JSON Schema currently accompanies the catalog. Runtime Zod validation helps the server, but it does not give editors validation while someone writes a preset.

## Proposed JSON contract

Retain the existing catalog file and its endpoint map. Add `piAiQuirks` as an alternative to `piAiProvider`; allow both to be absent. The names below are the proposed public JSON names; the persisted provider-config names follow the existing snake_case convention.

| Catalog field | Meaning |
| --- | --- |
| `piAiProvider` | Existing, real pi-ai builtin ID. Continue using pi-ai's model catalog and per-model links. Optional in the revised schema. |
| `piAiQuirks` | Explicit, typed pi-ai-style behavior for a provider without a pi-ai catalog definition. Optional. Mutually exclusive with `piAiProvider`. |
| Neither field | No registry-based quirk handling. Ordinary configured endpoint routing still works. |
| `autoCompat` | Existing opt-in. Keep it for the first two cases. It must be false or omitted when both quirk sources are absent; an omitted value becomes false. |

`piAiQuirks` needs a bounded shape, not `Record<string, unknown>`. Its keys are target API types from `apiBaseUrl` (`chat`, `messages`, `responses`, and only other types the compatibility code explicitly supports). Each entry declares the corresponding pi-ai API dialect and only the pi-ai-style attributes the gateway actually reads, such as `reasoning`, `thinkingLevelMap`, `maxTokens`, and supported `compat` flags (`thinkingFormat`, `supportsTemperature`, `maxTokensField`, `forceAdaptiveThinking`, and `supportsReasoningEffort`). The schema should constrain enum values to those handled by the existing projections. Do not pass arbitrary JSON straight into a pi-ai `Model` cast or silently accept unimplemented quirk keys.

The API dialect belongs to each target type, not to the provider as a whole: one provider may expose chat, messages, and responses at the same time. Use this shape (the names of the TypeScript types are illustrative):

```ts
type PiAiQuirks = Record<
  TargetApiType,
  {
    api: SupportedPiAiApi;
    reasoning?: boolean;
    thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
    maxTokens?: number;
    compat?: SupportedCompat;
    models?: Record<
      string, // exact upstream model ID, including any slash
      {
        reasoning?: boolean;
        thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
        maxTokens?: number;
        compat?: SupportedCompat;
      }
    >;
  }
>;
```

Only declare a target-level quirk if it applies to every model using that target. Put model-specific differences in `models`, keyed by the actual upstream ID. A model entry overrides common scalar values; its `thinkingLevelMap` replaces the common map so unsupported levels cannot leak through, while `compat` merges only named flags. An unlisted model gets the declared common quirks only. Unspecified capabilities remain unknown and must not cause a reasoning rewrite, clamp, or advertised capability. This keeps the inline definition useful without pretending that all models from a gateway have identical limits.

Illustrative entries (not claims about real providers):

```json
{
  "presets": [
    {
      "id": "builtin-example",
      "name": "Builtin example",
      "suggestedProviderId": "builtin-example",
      "suggestedName": "Builtin example",
      "apiBaseUrl": { "chat": "https://builtin.example.test/v1" },
      "piAiProvider": "openai",
      "autoCompat": true
    },
    {
      "id": "inline-example",
      "name": "Inline example",
      "suggestedProviderId": "inline-example",
      "suggestedName": "Inline example",
      "apiBaseUrl": { "chat": "https://inline.example.test/v1" },
      "piAiQuirks": {
        "chat": {
          "api": "openai-completions",
          "compat": { "maxTokensField": "max_completion_tokens" }
        }
      },
      "autoCompat": true
    },
    {
      "id": "plain-example",
      "name": "Plain example",
      "suggestedProviderId": "plain-example",
      "suggestedName": "Plain example",
      "apiBaseUrl": { "chat": "https://plain.example.test/v1" }
    }
  ]
}
```

These examples show the three quirk modes. An inline entry can omit `autoCompat` to leave the declared quirks available but inactive until an operator opts in; a plain entry cannot turn it on.

### Validation rules

1. Require the existing identity fields and at least one `apiBaseUrl` entry. Exactly zero or one of `piAiProvider` and `piAiQuirks` may appear. Reject both together, an empty `piAiQuirks`, unsupported API dialects or quirk keys, a quirk entry for an API type absent from `apiBaseUrl`, and `autoCompat: true` without a source.
2. Validate inline semantics, not just types. For example, a `thinkingLevelMap` needs an explicit reasoning-capable model declaration before it can drive a reasoning rewrite. A missing or unknown value is not equivalent to `false`. If a particular pi-ai quirk cannot be represented safely at provider scope, require a model-specific entry instead of inventing a default.
3. Keep the existing endpoint URL and `templateVars` validation, catalog-wide duplicate-ID checks, and remote-failure behavior. Invalid remote entries must not partially apply. The published schema helps editors, but runtime Zod checks remain authoritative for cross-field and cross-entry rules that JSON Schema does not express cleanly.

## Publish an editor schema

Add a real JSON Schema file at `packages/backend/data/provider-presets.schema.json`, using JSON Schema Draft 2020-12. Give it a stable `$id` and publish it at the raw GitHub URL for that path. Put a `$schema` reference at the top of `provider-presets.json` so VS Code, JetBrains, and other JSON Schema-aware editors validate the file without local setup. Keep the existing top-level `$comment` if useful.

The published schema must describe the **whole file** (`{ "presets": [...] }`), not just an individual preset. It should cover required fields, URL shapes, `templateVars`, `experimentalApis`, allowed quirk names and enums, nonempty endpoint maps, and the mutually exclusive `piAiProvider`/`piAiQuirks` choice. Use `additionalProperties: false` on the quirk objects: a typo in `thinkingFormat` must be an editor error, not an ignored runtime no-op. The loader may still accept a bare array for historical inputs; the committed catalog and editor schema should use the object form.

Keep the editor schema and `ProviderPresetSchema` synchronized with a repeatable generation/check step rather than maintaining two unrelated definitions by hand. Zod refinements such as placeholder-to-`templateVars` references and catalog-wide ID uniqueness still need explicit runtime checks and behavioral tests even if the generated JSON Schema cannot encode them. Add a CI check that fails if the published file is stale and validates the committed catalog against both the JSON Schema and runtime parser. Do not claim that editor validation alone proves the catalog is usable.

The new JSON contract is not valid against older binaries, which currently require `piAiProvider`. Those binaries already fall back to their embedded catalog when a remote catalog fails validation. Publish the new catalog shape only after runtime support ships, and call out that older binaries will continue using their embedded definitions; do not fabricate pi-ai IDs solely to keep the new file parseable on old releases.

## Runtime and persistence changes

1. In [`packages/shared/src/provider-presets.ts`](packages/shared/src/provider-presets.ts), implement the three-way schema and update `applyProviderPreset` to copy inline quirks instead of requiring a `piAiProvider`. Selecting a new preset must clear the prior preset's quirk source unless the operator has edited it. Switching back to Custom must restore pre-preset values under the picker's existing "restore only untouched fields" rule.
2. Add `pi_ai_quirks` to [`ProviderConfigSchema`](packages/backend/src/config.ts) and the frontend `Provider`/save/load mapping ([`settings.ts`](packages/frontend/src/lib/api/settings.ts)). Persist it in both SQLite and Postgres provider tables through the repository mapping. Generate migrations with the project's migration workflow; do not hand-write migration artifacts. Saving a preset snapshots its quirks: a later remote catalog edit must not silently change a configured provider's behavior. Existing configured providers retain their current `pi_ai_provider` and per-model IDs unless edited.
3. Split `applyRegistryAutoCompat` into two resolved sources behind the existing `auto_compat` opt-in. The builtin path keeps its `(pi_ai_provider, pi_ai_model_id)` resolution. The inline path resolves the target API type and actual provider model ID, merges only declared common and model-specific quirks, and applies only supported projections. It must not require a pi-ai provider or model ID. The no-source path returns the unchanged payload. Do not register a fake pi-ai provider or borrow another provider's catalog to make inline definitions work.
4. For `GET /v1/models`, expose compatibility metadata only when a configured alias resolves to a builtin model or explicit inline traits. Do not emit another provider's `pi_provider`/`pi_model` identity for an inline definition. Preserve explicit alias metadata and model configuration precedence. This reads configured aliases; it does not fetch upstream model lists.
5. Update the preset picker text and state handling in [`ProviderPresetPicker.tsx`](packages/frontend/src/components/providers/ProviderPresetPicker.tsx) and the provider form. Show the actual mode (pi-ai link, inline quirks, or no quirks). Do not tell the operator that auto-compat is active when the selected mode has no quirk source.

## Delivery order and checks

1. Implement and exercise the shared schema, editor schema publication/check, and preset application rules. Test builtin, inline, and neither; exclusivity; invalid/unknown quirks; existing URL/template-variable validation; catalog-wide duplicate IDs; remote fallback. Confirm an editor can load the published schema from its raw URL after publication.
2. Add persistence and runtime inline quirk resolution. Cover requests to two protocols on one provider, a model-specific override, an unknown model, `auto_compat` off, and a builtin provider with and without a resolvable pi-ai model ID. Compare outbound payloads rather than merely asserting that the code ran. Verify save/reload on SQLite and Postgres, and that `/v1/models` does not claim a fake pi-ai identity.
3. Update the management OpenAPI contract and operator configuration docs for the new field and the three quirk modes. Run the affected tests, typecheck, lint check, and format check using the repository commands. Verify the Add Provider form in a real browser after frontend changes, including switching presets and returning to Custom. The rollout is complete when the catalog validates in editors and at runtime, all three modes survive save/reload, and inline quirks have a demonstrated request effect without pi-ai IDs.

No provider-specific preset addition is part of this plan.
