import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import {
  getDefaultResponsesExtensions,
  PiAiQuirksSchema,
  RESPONSES_EXTENSION_OPTIONS,
  type PiAiQuirks,
  type ResponsesExtension,
} from '@plexus/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';

/**
 * Structured editor for inline pi-ai quirks (`PiAiQuirks`) plus the provider's
 * Native Responses Extensions list. Quirks are an overlay: they layer onto the
 * provider's built-in pi-ai source (or stand alone when none is selected). Each
 * of the five dispatch target keys has a fixed dialect; the operator toggles
 * targets on, edits traits/compat (including the service tier map) and adds
 * exact-model overrides. Provider-wide extensions are edited in the Responses
 * tab. Both drafts stay local until Apply; Cancel/Escape mutate nothing.
 * Zero enabled quirks targets apply `undefined` quirks (never a schema error),
 * and an untouched extensions list echoes its stored representation so opening
 * the modal for extensions alone never rewrites the pi-ai source.
 */

type QuirksKey = keyof PiAiQuirks;
type QuirksTarget = NonNullable<PiAiQuirks[QuirksKey]>;
type QuirksTraits = Omit<QuirksTarget, 'api' | 'models'>;
type QuirksCompat = NonNullable<QuirksTraits['compat']>;
type ThinkingLevelMap = NonNullable<QuirksTraits['thinkingLevelMap']>;
type PiAiTargetApi = QuirksTarget['api'];
type TriState = 'unset' | 'true' | 'false';
type ThinkingFormatValue = NonNullable<QuirksCompat['thinkingFormat']>;
type MaxTokensFieldValue = NonNullable<QuirksCompat['maxTokensField']>;
type ServiceTierMap = NonNullable<QuirksTraits['serviceTierMap']>;
type ServiceTierKey = keyof ServiceTierMap;
type ServiceTierFormatValue = NonNullable<QuirksCompat['serviceTierFormat']>;

const THINKING_LEVELS: readonly (keyof ThinkingLevelMap)[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const THINKING_FORMATS: readonly ThinkingFormatValue[] = [
  'zai',
  'qwen',
  'qwen-chat-template',
  'deepseek',
  'openrouter',
  'ant-ling',
  'together',
  'string-thinking',
];

const MAX_TOKENS_FIELDS: readonly MaxTokensFieldValue[] = ['max_tokens', 'max_completion_tokens'];

const SERVICE_TIERS: readonly ServiceTierKey[] = [
  'auto',
  'standard',
  'flex',
  'priority',
  'ultrafast',
];

interface TargetDef {
  key: QuirksKey;
  api: PiAiTargetApi;
  label: string;
  description: string;
}

const TARGETS: readonly TargetDef[] = [
  {
    key: 'chat',
    api: 'openai-completions',
    label: 'Chat',
    description: 'OpenAI chat completions payloads',
  },
  {
    key: 'completions',
    api: 'openai-completions',
    label: 'Completions',
    description: 'OpenAI legacy completions payloads',
  },
  {
    key: 'messages',
    api: 'anthropic-messages',
    label: 'Messages',
    description: 'Anthropic messages payloads',
  },
  {
    key: 'responses',
    api: 'openai-responses',
    label: 'Responses',
    description: 'OpenAI Responses API payloads',
  },
  {
    key: 'gemini',
    api: 'google-generative-ai',
    label: 'Gemini',
    description: 'Google generative AI payloads',
  },
];

interface LevelDraftEntry {
  mode: 'omit' | 'value' | 'unsupported';
  value: string;
}
type LevelsDraft = Record<keyof ThinkingLevelMap, LevelDraftEntry>;

interface CompatDraft {
  supportsTemperature: TriState;
  supportsReasoningEffort: TriState;
  forceAdaptiveThinking: TriState;
  thinkingFormat: '' | ThinkingFormatValue;
  maxTokensField: '' | MaxTokensFieldValue;
  serviceTierFormat: '' | ServiceTierFormatValue;
}

interface ServiceTierDraftEntry {
  mode: 'omit' | 'value' | 'unsupported';
  value: string;
}
type ServiceTiersDraft = Record<ServiceTierKey, ServiceTierDraftEntry>;

interface TraitsDraft {
  reasoning: TriState;
  maxTokens: string;
  thinkingLevelMap: LevelsDraft;
  /**
   * True while the source-declared map is untouched, so an explicitly empty
   * `thinkingLevelMap` survives a round-trip. Any level edit clears it, letting
   * a map the operator empties drop back to inheritance/undefined.
   */
  thinkingLevelMapPresent: boolean;
  serviceTierMap: ServiceTiersDraft;
  /**
   * Mirrors `thinkingLevelMapPresent`: an untouched map round-trips verbatim,
   * and any edit lets an operator-cleared map drop back to undefined.
   */
  serviceTierMapPresent: boolean;
  compat: CompatDraft;
}

interface ModelOverrideDraft extends TraitsDraft {
  rowId: string;
  id: string;
}

interface TargetDraft extends TraitsDraft {
  enabled: boolean;
  models: ModelOverrideDraft[];
}

type QuirksDraft = Partial<Record<QuirksKey, TargetDraft>>;

let rowCounter = 0;
function nextRowId(): string {
  rowCounter += 1;
  return `quirks-model-${rowCounter}`;
}

function toTri(value: boolean | undefined): TriState {
  if (value === undefined) return 'unset';
  return value ? 'true' : 'false';
}

function triToBool(value: TriState): boolean | undefined {
  if (value === 'unset') return undefined;
  return value === 'true';
}

function blankLevels(): LevelsDraft {
  const levels = {} as LevelsDraft;
  for (const level of THINKING_LEVELS) {
    levels[level] = { mode: 'omit', value: '' };
  }
  return levels;
}

function blankServiceTiers(): ServiceTiersDraft {
  const tiers = {} as ServiceTiersDraft;
  for (const tier of SERVICE_TIERS) {
    tiers[tier] = { mode: 'omit', value: '' };
  }
  return tiers;
}

function blankCompat(): CompatDraft {
  return {
    supportsTemperature: 'unset',
    supportsReasoningEffort: 'unset',
    forceAdaptiveThinking: 'unset',
    thinkingFormat: '',
    maxTokensField: '',
    serviceTierFormat: '',
  };
}

function blankTraits(): TraitsDraft {
  return {
    reasoning: 'unset',
    maxTokens: '',
    thinkingLevelMap: blankLevels(),
    thinkingLevelMapPresent: false,
    serviceTierMap: blankServiceTiers(),
    serviceTierMapPresent: false,
    compat: blankCompat(),
  };
}

function blankTarget(): TargetDraft {
  return { enabled: true, ...blankTraits(), models: [] };
}

function levelsToDraft(map: ThinkingLevelMap | undefined): LevelsDraft {
  const levels = blankLevels();
  if (!map) return levels;
  for (const level of THINKING_LEVELS) {
    const value = map[level];
    if (value === undefined) continue;
    levels[level] = value === null ? { mode: 'unsupported', value: '' } : { mode: 'value', value };
  }
  return levels;
}

function serviceTiersToDraft(map: ServiceTierMap | undefined): ServiceTiersDraft {
  const tiers = blankServiceTiers();
  if (!map) return tiers;
  for (const tier of SERVICE_TIERS) {
    const value = map[tier];
    if (value === undefined) continue;
    tiers[tier] = value === null ? { mode: 'unsupported', value: '' } : { mode: 'value', value };
  }
  return tiers;
}

function compatToDraft(compat: QuirksCompat | undefined): CompatDraft {
  return {
    supportsTemperature: toTri(compat?.supportsTemperature),
    supportsReasoningEffort: toTri(compat?.supportsReasoningEffort),
    forceAdaptiveThinking: toTri(compat?.forceAdaptiveThinking),
    thinkingFormat: compat?.thinkingFormat ?? '',
    maxTokensField: compat?.maxTokensField ?? '',
    serviceTierFormat: compat?.serviceTierFormat ?? '',
  };
}

function traitsToDraft(traits: QuirksTraits | undefined): TraitsDraft {
  return {
    reasoning: toTri(traits?.reasoning),
    maxTokens: traits?.maxTokens !== undefined ? String(traits.maxTokens) : '',
    thinkingLevelMap: levelsToDraft(traits?.thinkingLevelMap),
    thinkingLevelMapPresent: traits?.thinkingLevelMap !== undefined,
    serviceTierMap: serviceTiersToDraft(traits?.serviceTierMap),
    serviceTierMapPresent: traits?.serviceTierMap !== undefined,
    compat: compatToDraft(traits?.compat),
  };
}

function targetToDraft(target: QuirksTarget): TargetDraft {
  return {
    enabled: true,
    ...traitsToDraft(target),
    models: Object.entries(target.models ?? {}).map(([id, traits]) => ({
      rowId: nextRowId(),
      id,
      ...traitsToDraft(traits),
    })),
  };
}

function cloneQuirks(quirks: PiAiQuirks | undefined): QuirksDraft {
  const draft: QuirksDraft = {};
  if (!quirks) return draft;
  for (const { key } of TARGETS) {
    const target = quirks[key];
    if (target) draft[key] = targetToDraft(target);
  }
  return draft;
}

function firstEnabledKey(quirks: PiAiQuirks | undefined): QuirksKey | undefined {
  if (!quirks) return undefined;
  return TARGETS.find(({ key }) => quirks[key] !== undefined)?.key;
}

function draftToLevels(levels: LevelsDraft, present: boolean): ThinkingLevelMap | undefined {
  const out: ThinkingLevelMap = {};
  let any = false;
  for (const level of THINKING_LEVELS) {
    const entry = levels[level];
    if (entry.mode === 'omit') continue;
    out[level] = entry.mode === 'unsupported' ? null : entry.value;
    any = true;
  }
  if (!any && !present) return undefined;
  return out;
}

function draftToServiceTiers(
  tiers: ServiceTiersDraft,
  present: boolean
): ServiceTierMap | undefined {
  const out: ServiceTierMap = {};
  let any = false;
  for (const tier of SERVICE_TIERS) {
    const entry = tiers[tier];
    if (entry.mode === 'omit') continue;
    out[tier] = entry.mode === 'unsupported' ? null : entry.value.trim();
    any = true;
  }
  if (!any && !present) return undefined;
  return out;
}

// Preserve every declared compat field, including ones not surfaced for the
// target's protocol, so switching protocols never silently drops stored values.
function draftToCompat(compat: CompatDraft): QuirksCompat | undefined {
  const out: QuirksCompat = {};
  let any = false;

  const temperature = triToBool(compat.supportsTemperature);
  if (temperature !== undefined) {
    out.supportsTemperature = temperature;
    any = true;
  }

  const reasoningEffort = triToBool(compat.supportsReasoningEffort);
  if (reasoningEffort !== undefined) {
    out.supportsReasoningEffort = reasoningEffort;
    any = true;
  }

  if (compat.thinkingFormat) {
    out.thinkingFormat = compat.thinkingFormat;
    any = true;
  }

  if (compat.maxTokensField) {
    out.maxTokensField = compat.maxTokensField;
    any = true;
  }

  if (compat.serviceTierFormat) {
    out.serviceTierFormat = compat.serviceTierFormat;
    any = true;
  }

  const adaptive = triToBool(compat.forceAdaptiveThinking);
  if (adaptive !== undefined) {
    out.forceAdaptiveThinking = adaptive;
    any = true;
  }

  return any ? out : undefined;
}

function draftToTraits(traits: TraitsDraft): QuirksTraits {
  const out: QuirksTraits = {};
  const reasoning = triToBool(traits.reasoning);
  if (reasoning !== undefined) out.reasoning = reasoning;

  const rawMaxTokens = traits.maxTokens.trim();
  if (rawMaxTokens) out.maxTokens = Number(rawMaxTokens);

  const levels = draftToLevels(traits.thinkingLevelMap, traits.thinkingLevelMapPresent);
  if (levels) out.thinkingLevelMap = levels;

  const serviceTiers = draftToServiceTiers(traits.serviceTierMap, traits.serviceTierMapPresent);
  if (serviceTiers) out.serviceTierMap = serviceTiers;

  const compat = draftToCompat(traits.compat);
  if (compat) out.compat = compat;

  return out;
}

interface BuiltTarget extends QuirksTraits {
  api: PiAiTargetApi;
  models?: Record<string, QuirksTraits>;
}

function toQuirks(draft: QuirksDraft): PiAiQuirks {
  const out = {} as PiAiQuirks;
  for (const { key, api } of TARGETS) {
    const target = draft[key];
    if (!target || !target.enabled) continue;

    const built: BuiltTarget = { api, ...draftToTraits(target) };
    const models: Record<string, QuirksTraits> = {};
    for (const model of target.models) {
      const id = model.id.trim();
      if (!id) continue;
      models[id] = draftToTraits(model);
    }
    if (Object.keys(models).length > 0) built.models = models;

    (out as unknown as Record<string, BuiltTarget | undefined>)[key] = built;
  }
  return out;
}

/** Reject issues the schema cannot see because the builder normalizes them away. */
function collectDraftErrors(draft: QuirksDraft): string[] {
  const errors: string[] = [];

  const checkLevels = (levels: LevelsDraft, scope: string) => {
    for (const level of THINKING_LEVELS) {
      const entry = levels[level];
      if (entry.mode === 'value' && entry.value.trim() === '') {
        errors.push(`${scope}: thinking level "${level}" needs a mapped value`);
      }
    }
  };

  const checkServiceTiers = (tiers: ServiceTiersDraft, scope: string) => {
    for (const tier of SERVICE_TIERS) {
      const entry = tiers[tier];
      if (entry.mode === 'value' && entry.value.trim() === '') {
        errors.push(`${scope}: service tier "${tier}" needs a mapped value`);
      }
    }
  };

  for (const { key, label } of TARGETS) {
    const target = draft[key];
    if (!target || !target.enabled) continue;

    checkLevels(target.thinkingLevelMap, `${label} base traits`);
    checkServiceTiers(target.serviceTierMap, `${label} base traits`);

    const seen = new Set<string>();
    target.models.forEach((model, index) => {
      const id = model.id.trim();
      const scope = id ? `${label} override "${id}"` : `${label} override #${index + 1}`;
      if (!id) {
        errors.push(`${scope}: model ID is required`);
      } else if (seen.has(id)) {
        errors.push(`${label}: duplicate model ID "${id}"`);
      } else {
        seen.add(id);
      }
      checkLevels(model.thinkingLevelMap, scope);
      checkServiceTiers(model.serviceTierMap, scope);
    });
  }

  return errors;
}

const LABEL_CLASS = 'font-body text-[11px] font-medium text-text-secondary';
const FIELD_CLASS =
  'h-[27px] py-0 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary';
const SECTION_CLASS = 'rounded-md border border-border-glass p-3';

function TriSelect({
  value,
  onChange,
  id,
}: {
  value: TriState;
  onChange: (value: TriState) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      className={`${FIELD_CLASS} w-full`}
      value={value}
      onChange={(e) => onChange(e.target.value as TriState)}
    >
      <option value="unset">Default</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

function LevelMapEditor({
  levels,
  onChange,
}: {
  levels: LevelsDraft;
  onChange: (levels: LevelsDraft) => void;
}) {
  const setLevel = (level: keyof ThinkingLevelMap, entry: LevelDraftEntry) => {
    onChange({ ...levels, [level]: entry });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {THINKING_LEVELS.map((level) => {
        const entry = levels[level];
        return (
          <div key={level} className="flex items-center gap-2">
            <span className="w-16 shrink-0 font-body text-[11px] text-text-secondary">{level}</span>
            <select
              className={`${FIELD_CLASS} w-32 shrink-0`}
              aria-label={`${level} thinking level mode`}
              value={entry.mode}
              onChange={(e) =>
                setLevel(level, {
                  ...entry,
                  mode: e.target.value as LevelDraftEntry['mode'],
                })
              }
            >
              <option value="omit">Default</option>
              <option value="value">Value</option>
              <option value="unsupported">Unsupported</option>
            </select>
            {entry.mode === 'value' && (
              <input
                className={`${FIELD_CLASS} min-w-0 flex-1`}
                aria-label={`${level} thinking level mapped value`}
                value={entry.value}
                placeholder="mapped value"
                onChange={(e) => setLevel(level, { ...entry, value: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ServiceTierMapEditor({
  tiers,
  onChange,
}: {
  tiers: ServiceTiersDraft;
  onChange: (tiers: ServiceTiersDraft) => void;
}) {
  const setTier = (tier: ServiceTierKey, entry: ServiceTierDraftEntry) => {
    onChange({ ...tiers, [tier]: entry });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {SERVICE_TIERS.map((tier) => {
        const entry = tiers[tier];
        return (
          <div key={tier} className="flex items-center gap-2">
            <span className="w-20 shrink-0 font-body text-[11px] text-text-secondary">{tier}</span>
            <select
              className={`${FIELD_CLASS} w-32 shrink-0`}
              aria-label={`${tier} service tier mode`}
              value={entry.mode}
              onChange={(e) =>
                setTier(tier, {
                  ...entry,
                  mode: e.target.value as ServiceTierDraftEntry['mode'],
                })
              }
            >
              <option value="omit">Default</option>
              <option value="value">Value</option>
              <option value="unsupported">Unsupported</option>
            </select>
            {entry.mode === 'value' && (
              <input
                className={`${FIELD_CLASS} min-w-0 flex-1`}
                aria-label={`${tier} service tier mapped value`}
                value={entry.value}
                placeholder="provider value"
                onChange={(e) => setTier(tier, { ...entry, value: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompatEditor({
  api,
  compat,
  onChange,
}: {
  api: PiAiTargetApi;
  compat: CompatDraft;
  onChange: (compat: CompatDraft) => void;
}) {
  const set = (patch: Partial<CompatDraft>) => onChange({ ...compat, ...patch });
  const isCompletions = api === 'openai-completions';
  const supportsServiceTier = api !== 'google-generative-ai';

  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL_CLASS}>Compat</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Supports temperature</span>
          <TriSelect
            value={compat.supportsTemperature}
            onChange={(value) => set({ supportsTemperature: value })}
          />
        </label>
        {isCompletions && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Supports reasoning effort</span>
            <TriSelect
              value={compat.supportsReasoningEffort}
              onChange={(value) => set({ supportsReasoningEffort: value })}
            />
          </label>
        )}
        {api === 'anthropic-messages' && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Force adaptive thinking</span>
            <TriSelect
              value={compat.forceAdaptiveThinking}
              onChange={(value) => set({ forceAdaptiveThinking: value })}
            />
          </label>
        )}
        {isCompletions && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Thinking format</span>
            <select
              className={`${FIELD_CLASS} w-full`}
              value={compat.thinkingFormat}
              onChange={(e) =>
                set({
                  thinkingFormat: e.target.value as CompatDraft['thinkingFormat'],
                })
              }
            >
              <option value="">Default</option>
              {THINKING_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </label>
        )}
        {isCompletions && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Max tokens field</span>
            <select
              className={`${FIELD_CLASS} w-full`}
              value={compat.maxTokensField}
              onChange={(e) =>
                set({
                  maxTokensField: e.target.value as CompatDraft['maxTokensField'],
                })
              }
            >
              <option value="">Default</option>
              {MAX_TOKENS_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
        )}
        {supportsServiceTier && (
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Service tier format</span>
            <select
              className={`${FIELD_CLASS} w-full`}
              value={compat.serviceTierFormat}
              onChange={(e) =>
                set({
                  serviceTierFormat: e.target.value as CompatDraft['serviceTierFormat'],
                })
              }
            >
              <option value="">Default</option>
              <option value="service-tier">service-tier (service_tier body)</option>
              {api === 'anthropic-messages' && (
                <option value="anthropic-speed">anthropic-speed (speed + beta header)</option>
              )}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function TraitsEditor({
  api,
  traits,
  inheritedReasoning = 'unset',
  onChange,
}: {
  api: PiAiTargetApi;
  traits: TraitsDraft;
  /** Reasoning inherited from base traits when the override leaves it unset. */
  inheritedReasoning?: TriState;
  onChange: (traits: TraitsDraft) => void;
}) {
  const effectiveReasoning = traits.reasoning === 'unset' ? inheritedReasoning : traits.reasoning;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Reasoning</span>
          <TriSelect
            value={traits.reasoning}
            onChange={(reasoning) => onChange({ ...traits, reasoning })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Max tokens</span>
          <input
            className={`${FIELD_CLASS} w-full`}
            type="text"
            inputMode="numeric"
            placeholder="No limit"
            value={traits.maxTokens}
            onChange={(e) => onChange({ ...traits, maxTokens: e.target.value })}
          />
        </label>
      </div>
      <CompatEditor
        api={api}
        compat={traits.compat}
        onChange={(compat) => onChange({ ...traits, compat })}
      />
      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>Thinking level map</span>
        {effectiveReasoning !== 'true' && (
          <span className="font-body text-[10px] text-text-muted">
            {inheritedReasoning !== 'unset'
              ? 'Requires Reasoning = true here or on the base traits to apply.'
              : 'Requires Reasoning = true here or inherited from the builtin model.'}
          </span>
        )}
        <LevelMapEditor
          levels={traits.thinkingLevelMap}
          onChange={(thinkingLevelMap) =>
            onChange({
              ...traits,
              thinkingLevelMap,
              thinkingLevelMapPresent: false,
            })
          }
        />
      </div>
      {api !== 'google-generative-ai' && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Service tier map</span>
          <span className="font-body text-[10px] leading-[1.35] text-text-muted">
            Canonical tier to upstream value for this API (auto, standard, flex, priority,
            ultrafast). Default means unset; Unsupported means this API has no exact tier. Neither
            is an error: Plexus sends the nearest supported equivalent instead (ultrafast to
            priority to standard; priority to standard; flex to standard). The `@fast` suffix is the
            client-side alias for priority. For Anthropic fast mode, map priority to fast and select
            anthropic-speed in Compat below. A format alone does not enable mapping.
          </span>
          <ServiceTierMapEditor
            tiers={traits.serviceTierMap}
            onChange={(serviceTierMap) =>
              onChange({
                ...traits,
                serviceTierMap,
                serviceTierMapPresent: false,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function ModelOverrideCard({
  api,
  baseReasoning,
  model,
  onChange,
  onRemove,
}: {
  api: PiAiTargetApi;
  baseReasoning: TriState;
  model: ModelOverrideDraft;
  onChange: (model: ModelOverrideDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-glass bg-bg-glass p-3">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL_CLASS}>Model ID</span>
          <input
            className={`${FIELD_CLASS} w-full`}
            value={model.id}
            placeholder="e.g. gpt-4o-mini"
            onChange={(e) => onChange({ ...model, id: e.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Remove model override"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <TraitsEditor
        api={api}
        traits={model}
        inheritedReasoning={baseReasoning}
        onChange={(traits) => onChange({ ...model, ...traits })}
      />
    </div>
  );
}

export interface ProviderQuirksModalProps {
  isOpen: boolean;
  onClose: () => void;
  quirks?: PiAiQuirks;
  /** Stored extensions override; `undefined` means derive from the provider. */
  responsesExtensions?: ResponsesExtension[];
  /** Provider identity used to derive default extensions when unset. */
  oauthProvider?: string;
  apiBaseUrl?: string | Record<string, string>;
  onApply: (result: {
    quirks: PiAiQuirks | undefined;
    responsesExtensions: ResponsesExtension[] | undefined;
  }) => void;
}

export function ProviderQuirksModal({
  isOpen,
  onClose,
  quirks,
  responsesExtensions,
  oauthProvider,
  apiBaseUrl,
  onApply,
}: ProviderQuirksModalProps) {
  const [draft, setDraft] = useState<QuirksDraft>({});
  const [activeKey, setActiveKey] = useState<QuirksKey>('chat');
  const [errors, setErrors] = useState<string[]>([]);
  const [extensionDraft, setExtensionDraft] = useState<ResponsesExtension[]>([]);
  // False until the operator changes extensions, so an untouched draft echoes the
  // stored value (undefined = provider default) instead of forcing an override.
  const [extensionsExplicit, setExtensionsExplicit] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(cloneQuirks(quirks));
    setErrors([]);
    setActiveKey(firstEnabledKey(quirks) ?? 'chat');
    setExtensionDraft(
      responsesExtensions ?? getDefaultResponsesExtensions({ oauthProvider, apiBaseUrl })
    );
    setExtensionsExplicit(responsesExtensions !== undefined);
  }, [isOpen, quirks, responsesExtensions, oauthProvider, apiBaseUrl]);

  // The provider modal this is nested inside listens for Escape on document
  // (bubble phase) and would close itself too. Intercept in the capture phase
  // and close only this modal; the shared Modal is left untouched.
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, onClose]);

  const patchTarget = (key: QuirksKey, patch: Partial<TargetDraft>) => {
    setDraft((prev) => {
      const target = prev[key];
      if (!target) return prev;
      return { ...prev, [key]: { ...target, ...patch } };
    });
  };

  const enableTarget = (key: QuirksKey) => {
    setDraft((prev) => (prev[key] ? prev : { ...prev, [key]: blankTarget() }));
  };

  const addModel = (key: QuirksKey) => {
    setDraft((prev) => {
      const target = prev[key];
      if (!target) return prev;
      const model: ModelOverrideDraft = {
        rowId: nextRowId(),
        id: '',
        ...blankTraits(),
      };
      return {
        ...prev,
        [key]: { ...target, models: [...target.models, model] },
      };
    });
  };

  const replaceModel = (key: QuirksKey, rowId: string, next: ModelOverrideDraft) => {
    setDraft((prev) => {
      const target = prev[key];
      if (!target) return prev;
      return {
        ...prev,
        [key]: {
          ...target,
          models: target.models.map((model) => (model.rowId === rowId ? next : model)),
        },
      };
    });
  };

  const removeModel = (key: QuirksKey, rowId: string) => {
    setDraft((prev) => {
      const target = prev[key];
      if (!target) return prev;
      return {
        ...prev,
        [key]: {
          ...target,
          models: target.models.filter((model) => model.rowId !== rowId),
        },
      };
    });
  };

  const toggleExtension = (value: ResponsesExtension, checked: boolean) => {
    const next = new Set(extensionDraft);
    if (checked) next.add(value);
    else next.delete(value);
    setExtensionDraft(
      RESPONSES_EXTENSION_OPTIONS.map((option) => option.value).filter((v) => next.has(v))
    );
    setExtensionsExplicit(true);
  };

  const useDefaultExtensions = () => {
    setExtensionDraft(getDefaultResponsesExtensions({ oauthProvider, apiBaseUrl }));
    setExtensionsExplicit(false);
  };

  const handleApply = () => {
    const draftErrors = collectDraftErrors(draft);
    if (draftErrors.length > 0) {
      setErrors(draftErrors);
      return;
    }
    const candidate = toQuirks(draft);
    // Zero enabled targets means no inline source, not an invalid empty quirks object.
    let validatedQuirks: PiAiQuirks | undefined;
    if (Object.keys(candidate).length > 0) {
      const result = PiAiQuirksSchema.safeParse(candidate);
      if (!result.success) {
        setErrors(
          result.error.issues.map((issue) => {
            const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
            return `${path}${issue.message}`;
          })
        );
        return;
      }
      validatedQuirks = result.data;
    }
    setErrors([]);
    onApply({
      quirks: validatedQuirks,
      responsesExtensions: extensionsExplicit ? extensionDraft : undefined,
    });
    onClose();
  };

  // Clear all is a single reset: inline quirks and the extensions override both
  // fall back to their provider defaults, matching the modal's combined scope.
  const handleClearAll = () => {
    setErrors([]);
    onApply({ quirks: undefined, responsesExtensions: undefined });
    onClose();
  };

  const targetDef = TARGETS.find(({ key }) => key === activeKey) ?? TARGETS[0];
  const target = draft[activeKey];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Custom provider quirks"
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={handleClearAll}>
            Clear all
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {errors.length > 0 && (
          <div className="flex gap-2 rounded-md border border-danger/30 bg-danger/10 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
            <ul className="flex list-disc flex-col gap-1 pl-4 font-body text-[11px] text-red-300">
              {errors.map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-1 overflow-x-auto">
          {TARGETS.map((def) => {
            const active = def.key === activeKey;
            const configured = draft[def.key]?.enabled === true;
            return (
              <button
                key={def.key}
                type="button"
                onClick={() => setActiveKey(def.key)}
                className={
                  active
                    ? 'inline-flex items-center gap-1.5 rounded-md border border-border-glass bg-bg-glass px-3 py-1.5 font-body text-xs font-medium text-primary'
                    : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-body text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text'
                }
                aria-pressed={active}
              >
                {def.label}
                {configured && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        {!target ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="font-body text-sm text-text-secondary">
              No {targetDef.label} quirks configured.
            </p>
            <Button
              type="button"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => enableTarget(activeKey)}
            >
              Configure {targetDef.label}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className={`${SECTION_CLASS} flex items-center justify-between gap-3`}>
              <div className="flex min-w-0 flex-col">
                <span className="font-body text-[12px] text-text">
                  Fixed dialect: <span className="font-mono text-[11px]">{targetDef.api}</span>
                </span>
                <span className="font-body text-[10px] text-text-muted">
                  {targetDef.description}
                </span>
              </div>
              <label className="flex shrink-0 items-center gap-2">
                <span className={LABEL_CLASS}>Enabled</span>
                <Switch
                  checked={target.enabled}
                  onChange={(checked) => patchTarget(activeKey, { enabled: checked })}
                  aria-label={`Enable ${targetDef.label} quirks`}
                />
              </label>
            </div>

            <div className={SECTION_CLASS}>
              <TraitsEditor
                api={targetDef.api}
                traits={target}
                onChange={(traits) => patchTarget(activeKey, traits)}
              />
            </div>

            <div className={`${SECTION_CLASS} flex flex-col gap-2`}>
              <div className="flex items-center justify-between gap-2">
                <span className={LABEL_CLASS}>Exact-model overrides</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<Plus size={14} />}
                  onClick={() => addModel(activeKey)}
                >
                  Add override
                </Button>
              </div>
              <p className="font-body text-[10px] text-text-muted">
                Overrides start from the base traits above: omitted traits inherit, compat fields
                merge per field, and a thinking level map or service tier map here replaces the base
                map entirely. Setting Reasoning = false removes the inherited thinking level map.
              </p>
              {target.models.length === 0 ? (
                <span className="font-body text-[11px] text-text-muted">
                  No model overrides. Base traits apply to every model.
                </span>
              ) : (
                <div className="flex flex-col gap-2">
                  {target.models.map((model) => (
                    <ModelOverrideCard
                      key={model.rowId}
                      api={targetDef.api}
                      baseReasoning={target.reasoning}
                      model={model}
                      onChange={(next) => replaceModel(activeKey, model.rowId, next)}
                      onRemove={() => removeModel(activeKey, model.rowId)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeKey === 'responses' && (
          <div className={`${SECTION_CLASS} flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL_CLASS}>Native Responses Extensions</span>
              {extensionsExplicit && (
                <button
                  type="button"
                  className="font-body text-[11px] text-primary hover:underline"
                  onClick={useDefaultExtensions}
                >
                  Use default
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {RESPONSES_EXTENSION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center justify-between gap-3 cursor-pointer"
                  title={option.description}
                >
                  <span className={LABEL_CLASS}>{option.label}</span>
                  <Switch
                    checked={extensionDraft.includes(option.value)}
                    onChange={(checked) => toggleExtension(option.value, checked)}
                    aria-label={option.label}
                  />
                </label>
              ))}
            </div>
            <p className="font-body text-[10px] leading-[1.35] text-text-muted">
              Responses API extensions this provider's Responses endpoint accepts verbatim. Requests
              using any other extension are flattened to plain function tools and split back on the
              response. The default follows the OAuth provider or Responses endpoint (Codex,
              api.openai.com, api.meta.ai); other endpoints accept custom tools only. Models routed
              via the responses:lite subtype always use the fixed lite contract instead. Clear all
              resets both the quirks above and these extensions to their provider defaults.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
