import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, Boxes, Server, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import type { PiAiApi, PiAiCustomProviderDef, PiAiCustomModelDef } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useToast } from '../contexts/ToastContext';

const PI_APIS: PiAiApi[] = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-generative-ai-vertex',
];

const selectClass =
  'w-full bg-bg-input border border-border-glass rounded-sm px-2 py-1.5 font-body text-[13px] text-text focus:outline-none focus:border-accent';
const labelClass = 'font-body text-[11px] text-text-muted block mb-0.5';
const helpClass = 'font-body text-[10px] text-text-secondary mt-1 leading-snug';
const helpKeyClass = 'font-mono text-text-muted';

/**
 * Field-level schema for pi-ai's per-API compat override objects. Sourced from
 * @earendil-works/pi-ai's OpenAICompletionsCompat / OpenAIResponsesCompat /
 * AnthropicMessagesCompat types. Only these APIs accept compat overrides; the
 * Google APIs have no compat shape (`never`).
 *
 * `control` selects the rendered input:
 *   - 'bool'    → checkbox (boolean)
 *   - 'select'  → dropdown over `options` (string enum)
 *   - 'json'    → small JSON textarea (nested object; advanced/rare)
 * A field is only stored when the user sets it; omitted keys fall back to the
 * pi-ai default (shown in `default`).
 */
type CompatControl = 'bool' | 'select' | 'json';
interface CompatFieldDef {
  key: string;
  control: CompatControl;
  desc: string;
  default?: string;
  options?: string[];
}
const COMPAT_FIELDS: Record<string, CompatFieldDef[]> = {
  'openai-completions': [
    {
      key: 'supportsStore',
      control: 'bool',
      desc: 'supports the `store` field',
      default: 'auto-detected',
    },
    {
      key: 'supportsDeveloperRole',
      control: 'bool',
      desc: 'uses `developer` role vs `system`',
      default: 'auto-detected',
    },
    {
      key: 'supportsReasoningEffort',
      control: 'bool',
      desc: 'supports `reasoning_effort`',
      default: 'auto-detected',
    },
    {
      key: 'supportsUsageInStreaming',
      control: 'bool',
      desc: 'stream_options.include_usage in streaming',
      default: 'true',
    },
    {
      key: 'maxTokensField',
      control: 'select',
      desc: 'which max-tokens field to send',
      default: 'auto-detected',
      options: ['max_completion_tokens', 'max_tokens'],
    },
    {
      key: 'requiresToolResultName',
      control: 'bool',
      desc: 'tool results require `name`',
      default: 'auto-detected',
    },
    {
      key: 'requiresAssistantAfterToolResult',
      control: 'bool',
      desc: 'need assistant msg between tool result and user',
      default: 'auto-detected',
    },
    {
      key: 'requiresThinkingAsText',
      control: 'bool',
      desc: 'convert thinking blocks to <thinking> text',
      default: 'auto-detected',
    },
    {
      key: 'requiresReasoningContentOnAssistantMessages',
      control: 'bool',
      desc: 'replay empty reasoning_content on assistants',
      default: 'auto-detected',
    },
    {
      key: 'thinkingFormat',
      control: 'select',
      desc: 'reasoning/thinking parameter format',
      default: 'openai',
      options: [
        'openai',
        'openrouter',
        'deepseek',
        'together',
        'zai',
        'qwen',
        'qwen-chat-template',
        'string-thinking',
        'ant-ling',
      ],
    },
    {
      key: 'openRouterRouting',
      control: 'json',
      desc: 'OpenRouter `provider` routing preferences (JSON object)',
    },
    {
      key: 'vercelGatewayRouting',
      control: 'json',
      desc: 'Vercel AI Gateway routing preferences (JSON object)',
    },
    {
      key: 'zaiToolStream',
      control: 'bool',
      desc: 'z.ai top-level `tool_stream: true`',
      default: 'false',
    },
    {
      key: 'supportsStrictMode',
      control: 'bool',
      desc: 'supports `strict` on tool defs',
      default: 'true',
    },
    {
      key: 'cacheControlFormat',
      control: 'select',
      desc: 'prompt-cache control convention',
      default: 'unset',
      options: ['anthropic'],
    },
    {
      key: 'sendSessionAffinityHeaders',
      control: 'bool',
      desc: 'send session-affinity headers when caching',
      default: 'false',
    },
    {
      key: 'supportsLongCacheRetention',
      control: 'bool',
      desc: '24h prompt cache retention',
      default: 'true',
    },
  ],
  'openai-responses': [
    {
      key: 'supportsDeveloperRole',
      control: 'bool',
      desc: 'uses `developer` role vs `system`',
      default: 'true',
    },
    {
      key: 'sendSessionIdHeader',
      control: 'bool',
      desc: 'send OpenAI `session_id` cache-affinity header',
      default: 'true',
    },
    {
      key: 'supportsLongCacheRetention',
      control: 'bool',
      desc: 'supports `prompt_cache_retention: "24h"`',
      default: 'true',
    },
  ],
  'azure-openai-responses': [
    {
      key: 'supportsDeveloperRole',
      control: 'bool',
      desc: 'uses `developer` role vs `system`',
      default: 'true',
    },
    {
      key: 'sendSessionIdHeader',
      control: 'bool',
      desc: 'send OpenAI `session_id` cache-affinity header',
      default: 'true',
    },
    {
      key: 'supportsLongCacheRetention',
      control: 'bool',
      desc: 'supports `prompt_cache_retention: "24h"`',
      default: 'true',
    },
  ],
  'openai-codex-responses': [
    {
      key: 'supportsDeveloperRole',
      control: 'bool',
      desc: 'uses `developer` role vs `system`',
      default: 'true',
    },
    {
      key: 'sendSessionIdHeader',
      control: 'bool',
      desc: 'send OpenAI `session_id` cache-affinity header',
      default: 'true',
    },
    {
      key: 'supportsLongCacheRetention',
      control: 'bool',
      desc: 'supports `prompt_cache_retention: "24h"`',
      default: 'true',
    },
  ],
  'anthropic-messages': [
    {
      key: 'supportsEagerToolInputStreaming',
      control: 'bool',
      desc: 'per-tool `eager_input_streaming`',
      default: 'true',
    },
    {
      key: 'supportsLongCacheRetention',
      control: 'bool',
      desc: 'cache_control.ttl "1h"',
      default: 'true',
    },
    {
      key: 'sendSessionAffinityHeaders',
      control: 'bool',
      desc: 'send x-session-affinity header when caching',
      default: 'false',
    },
    {
      key: 'supportsCacheControlOnTools',
      control: 'bool',
      desc: 'cache_control on tool defs',
      default: 'true',
    },
    { key: 'supportsTemperature', control: 'bool', desc: 'accepts `temperature`', default: 'true' },
    {
      key: 'forceAdaptiveThinking',
      control: 'bool',
      desc: 'force thinking.type "adaptive" + output_config.effort',
      default: 'false',
    },
    {
      key: 'allowEmptySignature',
      control: 'bool',
      desc: 'replay empty thinking signatures as `signature: ""`',
      default: 'false',
    },
  ],
};

/**
 * Typed editor for a compat override object. Renders one control per field
 * defined for the given upstream API (checkboxes for bools, dropdowns for
 * enums, a small JSON textarea for the rare nested-object fields). A field is
 * only included in the output when the user sets it; omitted keys fall back to
 * the pi-ai default.
 */
function CompatEditor({
  api,
  value,
  onChange,
}: {
  api: PiAiApi | undefined;
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  if (!api) {
    return (
      <p className={helpClass}>
        Compat shape depends on the base model&apos;s upstream API. Switch to standalone and pick an
        API to edit compat.
      </p>
    );
  }
  const fields = COMPAT_FIELDS[api];
  if (!fields || fields.length === 0) {
    return (
      <p className={helpClass}>
        The <span className={helpKeyClass}>{api}</span> API has no compat overrides.
      </p>
    );
  }

  const setField = (key: string, v: any) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '6px 12px',
        background: 'var(--color-bg-subtle)',
        padding: '8px',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {fields.map((f) => {
        const v = value[f.key];
        const title = f.default ? `${f.desc} (default: ${f.default})` : f.desc;
        if (f.control === 'bool') {
          // Optional boolean override: three states (unset / true / false).
          // Rendered as a dropdown since a checkbox can't express "unset" —
          // some fields default to "auto-detected", not just true/false.
          return (
            <label key={f.key} className="flex flex-col gap-0.5" title={title}>
              <span className="font-body text-[11px] text-text-secondary">
                {f.key}
                {f.default && <span className="text-text-muted"> (def: {f.default})</span>}
              </span>
              <select
                className={selectClass}
                value={v === undefined ? '' : v ? 'true' : 'false'}
                onChange={(e) => {
                  const raw = e.target.value;
                  setField(f.key, raw === '' ? undefined : raw === 'true');
                }}
              >
                <option value="">— default —</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
          );
        }
        if (f.control === 'select') {
          return (
            <label key={f.key} className="flex flex-col gap-0.5" title={title}>
              <span className="font-body text-[11px] text-text-secondary">
                {f.key}
                {f.default && <span className="text-text-muted"> (def: {f.default})</span>}
              </span>
              <select
                className={selectClass}
                value={v ?? ''}
                onChange={(e) => setField(f.key, e.target.value || undefined)}
              >
                <option value="">— unset —</option>
                {f.options!.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        // json
        return (
          <label key={f.key} className="flex flex-col gap-0.5" style={{ gridColumn: '1 / -1' }}>
            <span className="font-body text-[11px] text-text-secondary" title={title}>
              {f.key} <span className="text-text-muted">(JSON object, advanced)</span>
            </span>
            <textarea
              className={`${selectClass} font-mono`}
              rows={2}
              placeholder="{ }"
              value={typeof v === 'string' ? v : v ? JSON.stringify(v, null, 2) : ''}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}

/**
 * Normalize a compat object for saving: parse any `json`-control fields from
 * their textarea string into real objects, and drop empty/invalid entries.
 * Throws on invalid JSON in a json-field.
 */
function compatValueForSave(
  api: PiAiApi | undefined,
  raw: Record<string, any>
): Record<string, any> | undefined {
  if (Object.keys(raw).length === 0) return undefined;
  const fields = api ? COMPAT_FIELDS[api] : undefined;
  const fieldMap = new Map((fields ?? []).map((f) => [f.key, f]));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === '') continue;
    const f = fieldMap.get(k);
    if (!f) continue;
    if (f.control === 'json' && typeof v === 'string') {
      const t = v.trim();
      if (!t) continue;
      const parsed = JSON.parse(t);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${k} must be a JSON object`);
      }
      out[k] = parsed;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Valid keys for pi-ai's `thinkingLevelMap`. Sourced from the `ThinkingLevelMap`
 * type in @earendil-works/pi-ai (minimal/low/medium/high/xhigh/off). Values are
 * provider-specific strings, or `null` to mark a level as unsupported. Omitted
 * keys fall back to the provider's default.
 */
const THINKING_LEVELS: { key: string; desc: string }[] = [
  { key: 'minimal', desc: 'minimal reasoning effort' },
  { key: 'low', desc: 'low reasoning effort' },
  { key: 'medium', desc: 'medium reasoning effort' },
  { key: 'high', desc: 'high reasoning effort' },
  { key: 'xhigh', desc: 'extra-high reasoning effort' },
  { key: 'off', desc: 'reasoning disabled' },
];

/**
 * Typed editor for `thinkingLevelMap`. Each of the 6 levels gets a row with a
 * text input for the provider-specific value and a checkbox to mark the level
 * unsupported (null). A level is only stored when set; omitted levels fall back
 * to the provider's default.
 */
function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null>;
  onChange: (next: Record<string, string | null>) => void;
}) {
  const setLevel = (key: string, v: string | null | undefined) => {
    const next = { ...value };
    if (v === undefined || v === '') delete next[key];
    else next[key] = v;
    onChange(next);
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '6px 12px',
        background: 'var(--color-bg-subtle)',
        padding: '8px',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {THINKING_LEVELS.map((l) => {
        const v = value[l.key];
        const unsupported = v === null;
        return (
          <label key={l.key} className="flex flex-col gap-0.5" title={l.desc}>
            <span className="font-body text-[11px] text-text-secondary">{l.key}</span>
            <div className="flex items-center gap-1.5">
              <input
                className={`${selectClass} flex-1`}
                placeholder="provider value"
                value={unsupported ? '' : (v ?? '')}
                disabled={unsupported}
                onChange={(e) => setLevel(l.key, e.target.value || undefined)}
              />
              <label className="flex items-center gap-1 cursor-pointer font-body text-[11px] text-text-muted whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={unsupported}
                  onChange={(e) => setLevel(l.key, e.target.checked ? null : undefined)}
                />
                n/a
              </label>
            </div>
          </label>
        );
      })}
    </div>
  );
}

/** Normalize a thinkingLevelMap for saving: drop empty entries; keep nulls. */
function tlmValueForSave(
  raw: Record<string, string | null>
): Record<string, string | null> | undefined {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || (typeof v === 'string' && v !== '')) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function PiRegistry() {
  const toast = useToast();
  const [providers, setProviders] = useState<Record<string, PiAiCustomProviderDef>>({});
  const [models, setModels] = useState<Record<string, PiAiCustomModelDef>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([api.getPiCustomProviders(), api.getPiCustomModels()]);
      setProviders(p);
      setModels(m);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load registries');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <PageContainer>
      <PageHeader
        title="pi-ai Registry"
        subtitle="Define custom providers and new/inherited models for the beta inference path that aren't yet in pi-ai's built-in registry."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <CustomProvidersCard
          providers={providers}
          models={models}
          loading={loading}
          onChanged={reload}
        />
      </div>
    </PageContainer>
  );
}

// ─── Custom Providers ────────────────────────────────────────────────────────

function CustomProvidersCard({
  providers,
  models,
  loading,
  onChanged,
}: {
  providers: Record<string, PiAiCustomProviderDef>;
  models: Record<string, PiAiCustomModelDef>;
  loading: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [draftName, setDraftName] = useState('');

  const entries = Object.entries(providers);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Server size={16} className="text-text-muted" />
        <h3 className="font-body text-[14px] font-semibold text-text">Custom Providers</h3>
      </div>
      <p className="font-body text-[12px] text-text-muted mb-3">
        A custom provider supplies the upstream wire API (and optional compat overrides) for a niche
        host pi-ai doesn&apos;t recognise. Reference it from a Plexus provider&apos;s{' '}
        <span className="font-mono">pi-ai Provider</span> field.
      </p>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="new provider id (e.g. niche-host)"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Plus size={14} />}
          disabled={!draftName.trim() || !!providers[draftName.trim()]}
          onClick={async () => {
            const name = draftName.trim();
            try {
              await api.savePiCustomProvider(name, { api: 'openai-completions' });
              setDraftName('');
              toast.success(`Created provider '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to create');
            }
          }}
        >
          Add
        </Button>
      </div>

      {loading && <div className="font-body text-[12px] text-text-muted">Loading…</div>}
      {!loading && entries.length === 0 && (
        <div className="font-body text-[12px] text-text-secondary italic">
          No custom providers defined.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map(([name, def]) => (
          <ProviderRow key={name} name={name} def={def} models={models} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

function ProviderRow({
  name,
  def,
  models,
  onChanged,
}: {
  name: string;
  def: PiAiCustomProviderDef;
  models: Record<string, PiAiCustomModelDef>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [apiVal, setApiVal] = useState<PiAiApi>(def.api);
  const [displayName, setDisplayName] = useState(def.display_name ?? '');
  const [compat, setCompat] = useState<Record<string, any>>(def.compat ?? {});
  const [open, setOpen] = useState(true);
  const [modelsOpen, setModelsOpen] = useState(true);
  const [draftModel, setDraftModel] = useState('');

  // Child models: those scoped to this provider (def.provider === name).
  const childModels = Object.entries(models).filter(([, m]) => m.provider === name);
  const isSystemDefault = name.startsWith('fallback-');

  return (
    <div className="border border-border-glass rounded-md">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-bg-hover"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-mono text-[13px] text-text">{name}</span>
          {isSystemDefault && (
            <Badge status="info" style={{ fontSize: '10px', padding: '2px 8px' }}>
              System Default
            </Badge>
          )}
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            {apiVal}
          </Badge>
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            {childModels.length} model{childModels.length === 1 ? '' : 's'}
          </Badge>
        </div>
        {!isSystemDefault && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await api.deletePiCustomProvider(name);
                toast.success(`Deleted '${name}'`);
                onChanged();
              } catch (e: any) {
                toast.error(e?.message ?? 'Failed to delete');
              }
            }}
          >
            <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
          </Button>
        )}
      </div>
      {open && (
        <div className="p-3 pt-0">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <label className={labelClass}>Upstream API</label>
              <select
                className={selectClass}
                value={apiVal}
                onChange={(e) => setApiVal(e.target.value as PiAiApi)}
              >
                {PI_APIS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className={labelClass}>Display name (optional)</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </div>
          <label className={labelClass}>compat overrides (optional)</label>
          <CompatEditor api={apiVal} value={compat} onChange={setCompat} />
          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              leftIcon={<Save size={14} />}
              onClick={async () => {
                let compatOut: Record<string, any> | undefined;
                try {
                  compatOut = compatValueForSave(apiVal, compat);
                } catch (e: any) {
                  toast.error(`Invalid compat: ${e.message}`);
                  return;
                }
                try {
                  await api.savePiCustomProvider(name, {
                    api: apiVal,
                    ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
                    ...(compatOut ? { compat: compatOut } : {}),
                  });
                  toast.success(`Saved '${name}'`);
                  onChanged();
                } catch (e: any) {
                  toast.error(e?.message ?? 'Failed to save');
                }
              }}
            >
              Save
            </Button>
          </div>

          {/* Nested child models scoped to this provider. */}
          <div className="border-t border-border-glass mt-3 pt-3">
            <button
              type="button"
              className="flex items-center gap-1.5 cursor-pointer w-full text-left mb-2"
              onClick={() => setModelsOpen((v) => !v)}
            >
              {modelsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Boxes size={14} className="text-text-muted" />
              <span className="font-body text-[12px] font-semibold text-text">
                Models under {name}
              </span>
              <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                {childModels.length}
              </Badge>
            </button>
            {modelsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="flex gap-2">
                  <Input
                    placeholder="new model id (e.g. gpt-5.6)"
                    value={draftModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Plus size={14} />}
                    disabled={(() => {
                      const trimmedModel = draftModel.trim();
                      const isValidModelId = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]*$/.test(trimmedModel);
                      return (
                        !trimmedModel ||
                        !isValidModelId ||
                        !!models[`${name}:${trimmedModel}`] ||
                        (!!models[trimmedModel] && models[trimmedModel].provider === name)
                      );
                    })()}
                    onClick={async () => {
                      const id = draftModel.trim();
                      const key = `${name}:${id}`;
                      try {
                        // Seed under this provider; user edits the rest below.
                        await api.savePiCustomModel(key, {
                          provider: name,
                          api: 'openai-completions',
                        });
                        setDraftModel('');
                        toast.success(`Created model '${id}' under ${name}`);
                        onChanged();
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Failed to create');
                      }
                    }}
                  >
                    Add Model
                  </Button>
                </div>
                {childModels.length === 0 && (
                  <div className="font-body text-[12px] text-text-secondary italic">
                    No models under this provider yet.
                  </div>
                )}
                {childModels.map(([mName, mDef]) => (
                  <ModelRow
                    key={mName}
                    name={mName}
                    def={mDef}
                    providerId={name}
                    onChanged={onChanged}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
  name,
  def,
  providerId,
  onChanged,
}: {
  name: string;
  def: PiAiCustomModelDef;
  /** Parent custom provider id this model is scoped to. */
  providerId: string;
  onChanged: () => void;
}) {
  const cleanName = name.includes(':') ? name.split(':').slice(1).join(':') : name;
  const toast = useToast();
  const [mode, setMode] = useState<'inherit' | 'standalone'>(
    def.inherits ? 'inherit' : 'standalone'
  );
  const [inheritProvider, setInheritProvider] = useState(def.inherits?.provider ?? '');
  const [inheritModel, setInheritModel] = useState(def.inherits?.model_id ?? '');
  const [apiVal, setApiVal] = useState<PiAiApi>(def.api ?? 'openai-completions');
  const [contextWindow, setContextWindow] = useState(def.contextWindow?.toString() ?? '');
  const [maxTokens, setMaxTokens] = useState(def.maxTokens?.toString() ?? '');
  const [reasoning, setReasoning] = useState(def.reasoning ?? false);
  const [compat, setCompat] = useState<Record<string, any>>(def.compat ?? {});
  const [tlm, setTlm] = useState<Record<string, string | null>>(def.thinkingLevelMap ?? {});
  const [displayName, setDisplayName] = useState(def.name ?? '');
  const [inputText, setInputText] = useState(def.input?.includes('text') ?? false);
  const [inputImage, setInputImage] = useState(def.input?.includes('image') ?? false);
  const [costInput, setCostInput] = useState(def.cost?.input?.toString() ?? '');
  const [costOutput, setCostOutput] = useState(def.cost?.output?.toString() ?? '');
  const [costCacheRead, setCostCacheRead] = useState(def.cost?.cacheRead?.toString() ?? '');
  const [costCacheWrite, setCostCacheWrite] = useState(def.cost?.cacheWrite?.toString() ?? '');
  const [cloning, setCloning] = useState(false);

  // Built-in pi-ai registry providers + models, for the inherit-base dropdowns.
  const [piProviders, setPiProviders] = useState<string[]>([]);
  const [inheritModels, setInheritModels] = useState<
    Array<{ id: string; name: string; api: string }>
  >([]);

  useEffect(() => {
    api
      .getPiProviders()
      .then(setPiProviders)
      .catch(() => setPiProviders([]));
  }, []);

  // When the selected base provider changes, load its built-in models.
  useEffect(() => {
    if (!inheritProvider) {
      setInheritModels([]);
      return;
    }
    api
      .getPiModels(inheritProvider)
      .then((ms) => setInheritModels(ms.filter((m) => !m.custom)))
      .catch(() => setInheritModels([]));
  }, [inheritProvider]);

  const num = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const float = (s: string): number | undefined => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  /** Fetch the base registry model and bake its fields into a standalone config. */
  const cloneFromBase = async () => {
    const p = inheritProvider.trim();
    const m = inheritModel.trim();
    if (!p || !m) {
      toast.error('Pick a base provider and model id to clone');
      return;
    }
    setCloning(true);
    try {
      const spec = await api.getPiRegistryModel(p, m);
      if (spec.api) setApiVal(spec.api);
      setDisplayName(spec.name ?? '');
      if (typeof spec.contextWindow === 'number') setContextWindow(String(spec.contextWindow));
      if (typeof spec.maxTokens === 'number') setMaxTokens(String(spec.maxTokens));
      setReasoning(spec.reasoning ?? false);
      setTlm(spec.thinkingLevelMap ?? {});
      setCompat(spec.compat ?? {});
      setInputText(spec.input?.includes('text') ?? false);
      setInputImage(spec.input?.includes('image') ?? false);
      setCostInput(spec.cost?.input?.toString() ?? '');
      setCostOutput(spec.cost?.output?.toString() ?? '');
      setCostCacheRead(spec.cost?.cacheRead?.toString() ?? '');
      setCostCacheWrite(spec.cost?.cacheWrite?.toString() ?? '');
      setMode('standalone');
      toast.success(`Cloned ${p}/${m} into a standalone config — review and Save`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to clone base model');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="border border-border-glass rounded-md p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="font-mono text-[13px] text-text">{cleanName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await api.deletePiCustomModel(name);
              toast.success(`Deleted '${cleanName}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to delete');
            }
          }}
        >
          <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
        </Button>
      </div>

      <div className="flex gap-3 mb-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === 'inherit'} onChange={() => setMode('inherit')} />
          <span className="font-body text-[12px] text-text">Inherit a base model</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'standalone'}
            onChange={() => setMode('standalone')}
          />
          <span className="font-body text-[12px] text-text">Standalone</span>
        </label>
      </div>

      {mode === 'inherit' ? (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <div style={{ flex: 1 }}>
              <label className={labelClass}>Base provider</label>
              <select
                className={selectClass}
                value={inheritProvider}
                onChange={(e) => {
                  setInheritProvider(e.target.value);
                  setInheritModel('');
                }}
              >
                <option value="">— select —</option>
                {piProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className={labelClass}>Base model id</label>
              <select
                className={selectClass}
                value={inheritModel}
                onChange={(e) => setInheritModel(e.target.value)}
                disabled={!inheritProvider}
              >
                <option value="">— select —</option>
                {inheritModels.map((m) => (
                  <option key={m.id} value={m.id} title={m.api}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end mb-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Copy size={14} />}
              disabled={cloning}
              onClick={cloneFromBase}
            >
              {cloning ? 'Cloning…' : 'Clone to standalone'}
            </Button>
          </div>
          <p className={`${helpClass} mb-2`}>
            Inherit keeps a live link to the base (deep-merged at request time).{' '}
            <span className={helpKeyClass}>Clone to standalone</span> copies the base&apos;s full
            field set into this model so you can edit it independently — the link is severed on
            Save.
          </p>
        </>
      ) : (
        <div style={{ marginBottom: '8px' }}>
          <label className={labelClass}>Upstream API</label>
          <select
            className={selectClass}
            value={apiVal}
            onChange={(e) => setApiVal(e.target.value as PiAiApi)}
          >
            {PI_APIS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>
            Context window {mode === 'inherit' ? '(override)' : ''}
          </label>
          <Input
            type="number"
            placeholder="tokens"
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>
            Max output tokens {mode === 'inherit' ? '(override)' : ''}
          </label>
          <Input
            type="number"
            placeholder="tokens"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
        <label className="flex items-end gap-1.5 cursor-pointer pb-1.5">
          <input
            type="checkbox"
            checked={reasoning}
            onChange={(e) => setReasoning(e.target.checked)}
          />
          <span className="font-body text-[12px] text-text">Reasoning</span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 2 }}>
          <label className={labelClass}>
            Display name {mode === 'inherit' ? '(override)' : '(optional)'}
          </label>
          <Input
            placeholder={cleanName}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>
            Input modalities {mode === 'inherit' ? '(override)' : ''}
          </label>
          <div className="flex items-center gap-3 h-[27px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={inputText}
                onChange={(e) => setInputText(e.target.checked)}
              />
              <span className="font-body text-[12px] text-text">text</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={inputImage}
                onChange={(e) => setInputImage(e.target.checked)}
              />
              <span className="font-body text-[12px] text-text">image</span>
            </label>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <label className={labelClass}>
          Cost per million tokens ($) {mode === 'inherit' ? '(override)' : '(optional)'}
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <Input
              type="number"
              step="any"
              min="0"
              placeholder="input"
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              type="number"
              step="any"
              min="0"
              placeholder="output"
              value={costOutput}
              onChange={(e) => setCostOutput(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              type="number"
              step="any"
              min="0"
              placeholder="cache read"
              value={costCacheRead}
              onChange={(e) => setCostCacheRead(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              type="number"
              step="any"
              min="0"
              placeholder="cache write"
              value={costCacheWrite}
              onChange={(e) => setCostCacheWrite(e.target.value)}
            />
          </div>
        </div>
      </div>

      <label className={labelClass}>thinking level map (optional)</label>
      <ThinkingLevelMapEditor value={tlm} onChange={setTlm} />
      <label className={`${labelClass} mt-2`}>compat overrides (optional)</label>
      <CompatEditor
        api={mode === 'standalone' ? apiVal : undefined}
        value={compat}
        onChange={setCompat}
      />

      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          leftIcon={<Save size={14} />}
          onClick={async () => {
            const compatApi = mode === 'standalone' ? apiVal : undefined;
            let compatOut: Record<string, any> | undefined;
            let tlmOut: Record<string, string | null> | undefined;
            try {
              compatOut = compatValueForSave(compatApi, compat);
              tlmOut = tlmValueForSave(tlm);
            } catch (e: any) {
              toast.error(`Invalid input: ${e.message}`);
              return;
            }
            const def: PiAiCustomModelDef = {
              // Preserve the parent provider association.
              provider: providerId,
              ...(mode === 'inherit'
                ? inheritProvider.trim() && inheritModel.trim()
                  ? {
                      inherits: { provider: inheritProvider.trim(), model_id: inheritModel.trim() },
                    }
                  : {}
                : { api: apiVal }),
              ...(displayName.trim() ? { name: displayName.trim() } : {}),
              ...(num(contextWindow) ? { contextWindow: num(contextWindow) } : {}),
              ...(num(maxTokens) ? { maxTokens: num(maxTokens) } : {}),
              ...(reasoning ? { reasoning: true } : {}),
              ...(tlmOut ? { thinkingLevelMap: tlmOut } : {}),
              ...(compatOut ? { compat: compatOut } : {}),
            };
            const inputs: Array<'text' | 'image'> = [];
            if (inputText) inputs.push('text');
            if (inputImage) inputs.push('image');
            if (inputs.length) def.input = inputs;
            const cost: Record<string, number> = {};
            if (float(costInput) != null) cost.input = float(costInput)!;
            if (float(costOutput) != null) cost.output = float(costOutput)!;
            if (float(costCacheRead) != null) cost.cacheRead = float(costCacheRead)!;
            if (float(costCacheWrite) != null) cost.cacheWrite = float(costCacheWrite)!;
            if (Object.keys(cost).length) def.cost = cost;
            if (!def.inherits && !def.api) {
              toast.error('Provide an inheritance base or an upstream API');
              return;
            }
            try {
              await api.savePiCustomModel(name, def);
              toast.success(`Saved '${cleanName}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to save');
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
