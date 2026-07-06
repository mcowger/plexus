import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { DebouncedInput } from '../ui/DebouncedInput';
import { Switch } from '../ui/Switch';
import { Badge } from '../ui/Badge';
import { GPU_PROFILE_OPTIONS, resolveGpuParams } from '@plexus/shared';
import type { Provider, CompactionSettings } from '../../lib/api';
import { api } from '../../lib/api';

export const KNOWN_ADAPTERS: { value: string; label: string; description: string }[] = [
  {
    value: 'reasoning_content',
    label: 'Reasoning Content',
    description:
      'Maps reasoning ↔ reasoning_content on messages and responses (e.g. Fireworks DeepSeek-R1).',
  },
  {
    value: 'suppress_developer_role',
    label: 'Suppress Developer Role',
    description: 'Rewrites the "developer" role to "system" for providers that do not support it.',
  },
  {
    value: 'model_override',
    label: 'Model Override',
    description:
      'Conditionally rewrites the model name based on request fields (e.g. switching to a -fast variant when reasoning is disabled).',
  },
  {
    value: 'reasoning_rewrite',
    label: 'Reasoning Rewrite',
    description:
      'Rewrites reasoning/thinking fields to provider-specific formats (e.g. enable_thinking, budget_tokens, thinking.type).',
  },
  {
    value: 'web_search_coercion',
    label: 'Web Search Coercion',
    description:
      'Coerces server-side web search tool entries to the format expected by this provider (Anthropic, OpenAI, or OpenRouter).',
  },
];

const WEB_SEARCH_TARGETS = [
  { value: 'anthropic', label: 'Anthropic (web_search_20250305)' },
  { value: 'openai', label: 'OpenAI (web_search)' },
  { value: 'openrouter', label: 'OpenRouter (openrouter:web_search)' },
  { value: 'google', label: 'Google (googleSearch)' },
] as const;

interface Props {
  editingProvider: Provider;
  setEditingProvider: React.Dispatch<React.SetStateAction<Provider>>;
  addKV: (field: 'headers' | 'extraBody') => void;
  updateKV: (field: 'headers' | 'extraBody', oldKey: string, newKey: string, value: any) => void;
  removeKV: (field: 'headers' | 'extraBody', key: string) => void;
}

export function ProviderAdvancedEditor({
  editingProvider,
  setEditingProvider,
  addKV,
  updateKV,
  removeKV,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdaptersOpen, setIsAdaptersOpen] = useState(false);
  const [isHeadersOpen, setIsHeadersOpen] = useState(false);
  const [isExtraBodyOpen, setIsExtraBodyOpen] = useState(false);
  const [isStallOpen, setIsStallOpen] = useState(false);
  const [isCompactionOpen, setIsCompactionOpen] = useState(false);

  // pi-ai provider dropdown
  const [piProviders, setPiProviders] = useState<string[]>([]);
  const [piProviderCustom, setPiProviderCustom] = useState(false);

  useEffect(() => {
    api
      .getPiProviders()
      .then(setPiProviders)
      .catch(() => {
        /* non-fatal — falls back to custom text input */
      });
  }, []);

  // Determine if the current value is already a known provider or needs custom mode
  useEffect(() => {
    const val = editingProvider.pi_ai_provider;
    if (val && piProviders.length > 0 && !piProviders.includes(val)) {
      setPiProviderCustom(true);
    }
  }, [editingProvider.pi_ai_provider, piProviders]);

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">Advanced</span>
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>
      {isOpen && (
        <div
          className="px-3 py-2 border-t border-border-glass"
          style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {/* Model Autosync */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div className="p-2 px-3 flex flex-wrap items-center gap-3 bg-bg-hover">
              <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-[190px]">
                <input
                  type="checkbox"
                  checked={editingProvider.modelAutosync?.enabled === true}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setEditingProvider({
                      ...editingProvider,
                      modelAutosync: {
                        enabled,
                        intervalMinutes: Math.max(
                          1,
                          editingProvider.modelAutosync?.intervalMinutes || 60
                        ),
                      },
                    });
                  }}
                />
                <span className="font-body text-[12px] font-medium text-text-secondary">
                  Enable Model Autosync
                </span>
              </label>
              <div className="flex items-center gap-2">
                <DebouncedInput
                  type="number"
                  min={1}
                  step={1}
                  disabled={editingProvider.modelAutosync?.enabled !== true}
                  value={String(editingProvider.modelAutosync?.intervalMinutes || 60)}
                  onChange={(val: string) => {
                    const intervalMinutes = Math.max(1, parseInt(val, 10) || 60);
                    setEditingProvider({
                      ...editingProvider,
                      modelAutosync: {
                        enabled: editingProvider.modelAutosync?.enabled === true,
                        intervalMinutes,
                      },
                    });
                  }}
                  style={{ width: '76px' }}
                />
                <span className="font-body text-[11px] text-text-secondary whitespace-nowrap">
                  Sync Interval Minutes
                </span>
              </div>
            </div>
          </div>

          {/* Provider Adapters */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsAdaptersOpen(!isAdaptersOpen)}
            >
              {isAdaptersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Provider Adapters
              </label>
              {(editingProvider.adapter ?? []).length > 0 && (
                <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                  {(editingProvider.adapter ?? []).length}
                </Badge>
              )}
            </div>
            {isAdaptersOpen && (
              <div
                style={{
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <div
                  className="font-body text-[11px] text-text-secondary mb-2"
                  style={{ lineHeight: 1.4 }}
                >
                  Adapters rewrite requests and responses to fix provider-specific field-name
                  incompatibilities. Applied to every model under this provider unless overridden
                  per-model.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                  {KNOWN_ADAPTERS.filter(
                    (a) =>
                      a.value !== 'model_override' &&
                      a.value !== 'reasoning_rewrite' &&
                      a.value !== 'web_search_coercion'
                  ).map((a) => {
                    const adapterEntries: any[] = editingProvider.adapter ?? [];
                    const active = adapterEntries.some(
                      (e: any) => (typeof e === 'string' ? e : e.name) === a.value
                    );
                    return (
                      <label
                        key={a.value}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border-glass)',
                          background: active ? 'var(--color-bg-hover)' : 'var(--color-bg-glass)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          style={{ marginTop: '2px', flexShrink: 0 }}
                          onChange={() => {
                            const current: any[] = editingProvider.adapter ?? [];
                            const next = active
                              ? current.filter(
                                  (e: any) => (typeof e === 'string' ? e : e.name) !== a.value
                                )
                              : [...current, { name: a.value, options: {} }];
                            setEditingProvider({ ...editingProvider, adapter: next });
                          }}
                        />
                        <div>
                          <div className="font-body text-[12px] font-medium text-text">
                            {a.label}
                          </div>
                          <div
                            className="font-body text-[11px] text-text-secondary"
                            style={{ lineHeight: 1.35 }}
                          >
                            {a.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Web Search Coercion — inline options editor */}
                {(() => {
                  const adapterEntries: any[] = editingProvider.adapter ?? [];
                  const entry = adapterEntries.find(
                    (e: any) => (typeof e === 'string' ? e : e.name) === 'web_search_coercion'
                  );
                  const active = !!entry;
                  const currentTarget: string = entry?.options?.target ?? '';
                  const currentMaxUses: string =
                    entry?.options?.max_uses != null ? String(entry.options.max_uses) : '';

                  const toggleActive = () => {
                    const current: any[] = editingProvider.adapter ?? [];
                    const next = active
                      ? current.filter(
                          (e: any) => (typeof e === 'string' ? e : e.name) !== 'web_search_coercion'
                        )
                      : [
                          ...current,
                          {
                            name: 'web_search_coercion',
                            options: { target: 'openai' },
                          },
                        ];
                    setEditingProvider({ ...editingProvider, adapter: next });
                  };

                  const updateOptions = (patch: Record<string, any>) => {
                    const current: any[] = editingProvider.adapter ?? [];
                    const next = current.map((e: any) => {
                      const name = typeof e === 'string' ? e : e.name;
                      if (name !== 'web_search_coercion') return e;
                      return { name: 'web_search_coercion', options: { ...e.options, ...patch } };
                    });
                    setEditingProvider({ ...editingProvider, adapter: next });
                  };

                  return (
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-glass)',
                        background: active ? 'var(--color-bg-hover)' : 'var(--color-bg-glass)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {/* Header row: checkbox + label */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          style={{ marginTop: '2px', flexShrink: 0 }}
                          onChange={toggleActive}
                        />
                        <div>
                          <div className="font-body text-[12px] font-medium text-text">
                            Web Search Coercion
                          </div>
                          <div
                            className="font-body text-[11px] text-text-secondary"
                            style={{ lineHeight: 1.35 }}
                          >
                            Coerces server-side web search tool entries to the format expected by
                            this provider.
                          </div>
                        </div>
                      </label>

                      {/* Options — only shown when active */}
                      {active && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'flex-end',
                            flexWrap: 'wrap',
                          }}
                        >
                          {/* Target dropdown */}
                          <div className="flex flex-col gap-0.5" style={{ flex: '1 1 160px' }}>
                            <label className="font-body text-[11px] font-medium text-text-secondary">
                              Target Format
                            </label>
                            <select
                              className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                              value={currentTarget}
                              onChange={(e) => updateOptions({ target: e.target.value })}
                            >
                              <option value="">— select —</option>
                              {WEB_SEARCH_TARGETS.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* max_uses — only relevant for Anthropic */}
                          {currentTarget === 'anthropic' && (
                            <div className="flex flex-col gap-0.5" style={{ flex: '0 1 110px' }}>
                              <label className="font-body text-[11px] font-medium text-text-secondary">
                                Max Uses
                                <span className="font-normal text-[10px] text-text-muted ml-1">
                                  optional
                                </span>
                              </label>
                              <input
                                className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                                type="number"
                                min="1"
                                step="1"
                                placeholder="No limit"
                                value={currentMaxUses}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    // Remove max_uses from options
                                    const current: any[] = editingProvider.adapter ?? [];
                                    const next = current.map((e2: any) => {
                                      const name = typeof e2 === 'string' ? e2 : e2.name;
                                      if (name !== 'web_search_coercion') return e2;
                                      const { max_uses: _removed, ...rest } = e2.options ?? {};
                                      return { name: 'web_search_coercion', options: rest };
                                    });
                                    setEditingProvider({ ...editingProvider, adapter: next });
                                  } else {
                                    const num = parseInt(raw, 10);
                                    if (Number.isFinite(num) && num >= 1) {
                                      updateOptions({ max_uses: num });
                                    }
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Stall Detection Overrides — with Cooldown on Stall toggle in header */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsStallOpen(!isStallOpen)}
            >
              {isStallOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Stall Detection Overrides
              </label>
              {/* Cooldown on Stall toggle — moved here from its own section */}
              <div
                className="flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
                title="When enabled, stall detection cancellations will trigger cooldown for this provider."
              >
                <Switch
                  checked={editingProvider.stallCooldown || false}
                  onChange={(checked) =>
                    setEditingProvider({ ...editingProvider, stallCooldown: checked })
                  }
                />
                <span className="font-body text-[11px] text-text-secondary whitespace-nowrap">
                  Cooldown on Stall
                </span>
              </div>
              {(editingProvider.stallTtfbMs != null ||
                editingProvider.stallTtfbBytes != null ||
                editingProvider.stallMinBps != null ||
                editingProvider.stallWindowMs != null ||
                editingProvider.stallGracePeriodMs != null) && (
                <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                  Custom
                </Badge>
              )}
            </div>
            {isStallOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <div
                  className="font-body text-[11px] text-text-secondary"
                  style={{ lineHeight: 1.35 }}
                >
                  Override the global stall detection settings for this provider. Leave empty to use
                  the global setting for each field.
                </div>
                {/* Stall inputs — two-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {/* TTFB Timeout */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      TTFB Timeout (s)
                      <span className="font-normal text-[10px] text-text-muted ml-1">5–120</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Global default"
                      value={
                        editingProvider.stallTtfbMs != null
                          ? String(Math.round(editingProvider.stallTtfbMs / 1000))
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        if (val === '') {
                          setEditingProvider({ ...editingProvider, stallTtfbMs: undefined });
                        } else if (Number.isFinite(num) && num >= 5 && num <= 120) {
                          setEditingProvider({ ...editingProvider, stallTtfbMs: num * 1000 });
                        }
                      }}
                    />
                  </div>
                  {/* TTFB Byte Threshold */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      TTFB Byte Threshold
                      <span className="font-normal text-[10px] text-text-muted ml-1">50–10k</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Global default"
                      value={
                        editingProvider.stallTtfbBytes != null
                          ? String(editingProvider.stallTtfbBytes)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        if (val === '') {
                          setEditingProvider({ ...editingProvider, stallTtfbBytes: undefined });
                        } else if (Number.isFinite(num) && num >= 50 && num <= 10000) {
                          setEditingProvider({ ...editingProvider, stallTtfbBytes: num });
                        }
                      }}
                    />
                  </div>
                  {/* Min Bytes/Sec */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Min Bytes/Sec
                      <span className="font-normal text-[10px] text-text-muted ml-1">50–5k</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Global default"
                      value={
                        editingProvider.stallMinBps != null
                          ? String(editingProvider.stallMinBps)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        if (val === '') {
                          setEditingProvider({ ...editingProvider, stallMinBps: undefined });
                        } else if (Number.isFinite(num) && num >= 50 && num <= 5000) {
                          setEditingProvider({ ...editingProvider, stallMinBps: num });
                        }
                      }}
                    />
                  </div>
                  {/* Stall Window */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Stall Window (s)
                      <span className="font-normal text-[10px] text-text-muted ml-1">3–30</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Global default"
                      value={
                        editingProvider.stallWindowMs != null
                          ? String(Math.round(editingProvider.stallWindowMs / 1000))
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        if (val === '') {
                          setEditingProvider({ ...editingProvider, stallWindowMs: undefined });
                        } else if (Number.isFinite(num) && num >= 3 && num <= 30) {
                          setEditingProvider({ ...editingProvider, stallWindowMs: num * 1000 });
                        }
                      }}
                    />
                  </div>
                  {/* Grace Period */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Grace Period (s)
                      <span className="font-normal text-[10px] text-text-muted ml-1">0–120</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Global default"
                      value={
                        editingProvider.stallGracePeriodMs != null
                          ? String(Math.round(editingProvider.stallGracePeriodMs / 1000))
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        if (val === '') {
                          setEditingProvider({
                            ...editingProvider,
                            stallGracePeriodMs: undefined,
                          });
                        } else if (Number.isFinite(num) && num >= 0 && num <= 120) {
                          setEditingProvider({
                            ...editingProvider,
                            stallGracePeriodMs: num * 1000,
                          });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Compaction Override */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <button
              type="button"
              className="w-full p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass border-0 text-left"
              onClick={() => setIsCompactionOpen(!isCompactionOpen)}
              aria-expanded={isCompactionOpen}
            >
              {isCompactionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Compaction Override
              </span>
              {editingProvider.compaction &&
                Object.values(editingProvider.compaction).some((v) => v != null) && (
                  <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                    Custom
                  </Badge>
                )}
            </button>
            {isCompactionOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <div
                  className="font-body text-[11px] text-text-secondary"
                  style={{ lineHeight: 1.35 }}
                >
                  Override global context-compaction for this provider. Empty = inherit. Nested
                  native/headroom settings are configurable on the global Config page only (v1).
                </div>
                {/* enabled tri-state: Inherit | On | Off */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Enabled
                    <span className="font-normal text-[10px] text-text-muted ml-1">
                      Inherit / On / Off
                    </span>
                  </label>
                  <select
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    value={
                      editingProvider.compaction?.enabled == null
                        ? ''
                        : editingProvider.compaction.enabled
                          ? 'true'
                          : 'false'
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      const enabled: boolean | undefined = raw === '' ? undefined : raw === 'true';
                      setEditingProvider({
                        ...editingProvider,
                        compaction: {
                          ...editingProvider.compaction,
                          enabled,
                        } as CompactionSettings,
                      });
                    }}
                  >
                    <option value="">Inherit</option>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </div>
                {/* strategy */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Strategy
                    <span className="font-normal text-[10px] text-text-muted ml-1">
                      native | headroom
                    </span>
                  </label>
                  <select
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    value={editingProvider.compaction?.strategy ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const strategy = (raw || undefined) as CompactionSettings['strategy'];
                      setEditingProvider({
                        ...editingProvider,
                        compaction: {
                          ...editingProvider.compaction,
                          strategy,
                        } as CompactionSettings,
                      });
                    }}
                  >
                    <option value="">Inherit</option>
                    <option value="native">native</option>
                    <option value="headroom">headroom</option>
                  </select>
                </div>
                {/* numeric fields — two-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {/* triggerRatio */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Trigger Ratio
                      <span className="font-normal text-[10px] text-text-muted ml-1">0–1</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Inherit"
                      min={0}
                      max={1}
                      step={0.01}
                      value={
                        editingProvider.compaction?.triggerRatio != null
                          ? String(editingProvider.compaction.triggerRatio)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const triggerRatio = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingProvider({
                          ...editingProvider,
                          compaction: {
                            ...editingProvider.compaction,
                            triggerRatio,
                          } as CompactionSettings,
                        });
                      }}
                    />
                  </div>
                  {/* absoluteTriggerTokens */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Abs. Trigger Tokens
                      <span className="font-normal text-[10px] text-text-muted ml-1">optional</span>
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Inherit"
                      min={0}
                      step={1}
                      value={
                        editingProvider.compaction?.absoluteTriggerTokens != null
                          ? String(editingProvider.compaction.absoluteTriggerTokens)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const absoluteTriggerTokens =
                          val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingProvider({
                          ...editingProvider,
                          compaction: {
                            ...editingProvider.compaction,
                            absoluteTriggerTokens,
                          } as CompactionSettings,
                        });
                      }}
                    />
                  </div>
                  {/* minTokens */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Min Tokens
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Inherit"
                      min={0}
                      step={1}
                      value={
                        editingProvider.compaction?.minTokens != null
                          ? String(editingProvider.compaction.minTokens)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const minTokens = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingProvider({
                          ...editingProvider,
                          compaction: {
                            ...editingProvider.compaction,
                            minTokens,
                          } as CompactionSettings,
                        });
                      }}
                    />
                  </div>
                  {/* protectRecent */}
                  <div>
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
                      Protect Recent
                    </label>
                    <DebouncedInput
                      type="number"
                      placeholder="Inherit"
                      min={0}
                      step={1}
                      value={
                        editingProvider.compaction?.protectRecent != null
                          ? String(editingProvider.compaction.protectRecent)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const protectRecent = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingProvider({
                          ...editingProvider,
                          compaction: {
                            ...editingProvider.compaction,
                            protectRecent,
                          } as CompactionSettings,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Custom Headers */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsHeadersOpen(!isHeadersOpen)}
            >
              {isHeadersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Custom Headers
              </label>
              <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                {Object.keys(editingProvider.headers || {}).length}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  addKV('headers');
                  setIsHeadersOpen(true);
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {isHeadersOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-deep)',
                }}
              >
                {Object.entries(editingProvider.headers || {}).length === 0 && (
                  <div className="font-body text-[11px] text-text-secondary italic">
                    No custom headers configured.
                  </div>
                )}
                {Object.entries(editingProvider.headers || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <DebouncedInput
                      placeholder="Header Name"
                      value={key}
                      onChange={(newKey: string) => updateKV('headers', key, newKey, val)}
                      style={{ flex: 1 }}
                    />
                    <DebouncedInput
                      placeholder="Value"
                      value={typeof val === 'object' ? JSON.stringify(val) : val}
                      onChange={(val: string) => {
                        try {
                          updateKV('headers', key, key, JSON.parse(val));
                        } catch {
                          updateKV('headers', key, key, val);
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeKV('headers', key)}
                      style={{ padding: '4px' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Extra Body Fields */}
          <div className="border border-border-glass rounded-md overflow-hidden">
            <div
              className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
              onClick={() => setIsExtraBodyOpen(!isExtraBodyOpen)}
            >
              {isExtraBodyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[12px] font-medium text-text-secondary"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Extra Body Fields
              </label>
              <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                {Object.keys(editingProvider.extraBody || {}).length}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  addKV('extraBody');
                  setIsExtraBodyOpen(true);
                }}
              >
                <Plus size={14} />
              </Button>
            </div>
            {isExtraBodyOpen && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '8px',
                  borderTop: '1px solid var(--color-border-glass)',
                  background: 'var(--color-bg-deep)',
                }}
              >
                {Object.entries(editingProvider.extraBody || {}).length === 0 && (
                  <div className="font-body text-[11px] text-text-secondary italic">
                    No extra body fields configured.
                  </div>
                )}
                {Object.entries(editingProvider.extraBody || {}).map(([key, val], idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <DebouncedInput
                      placeholder="Field Name"
                      value={key}
                      onChange={(newKey: string) => updateKV('extraBody', key, newKey, val)}
                      style={{ flex: 1 }}
                    />
                    <DebouncedInput
                      placeholder="Value"
                      value={typeof val === 'object' ? JSON.stringify(val) : val}
                      onChange={(val: string) => {
                        try {
                          updateKV('extraBody', key, key, JSON.parse(val));
                        } catch {
                          updateKV('extraBody', key, key, val);
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeKV('extraBody', key)}
                      style={{ padding: '4px' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compact settings card — toggles left, value inputs right */}
          <div className="border border-border-glass rounded-md p-2 bg-bg-subtle">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              {/* Left: toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <label className="flex items-start gap-2 py-1 cursor-pointer">
                  <Switch
                    checked={editingProvider.estimateTokens || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, estimateTokens: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-[12px] text-text">Estimate Tokens</div>
                    <div
                      className="font-body text-[11px] text-text-muted"
                      style={{ lineHeight: 1.35 }}
                    >
                      Only when provider doesn't return usage data. Use sparingly.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 py-1 cursor-pointer">
                  <Switch
                    checked={editingProvider.disableCooldown || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, disableCooldown: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-[12px] text-text">Disable Cooldowns</div>
                    <div
                      className="font-body text-[11px] text-text-muted"
                      style={{ lineHeight: 1.35 }}
                    >
                      Provider will never be placed on cooldown.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 py-1 cursor-pointer">
                  <Switch
                    checked={editingProvider.useClaudeMasking || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, useClaudeMasking: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-[12px] text-text">Use Claude Masking</div>
                    <div
                      className="font-body text-[11px] text-text-muted"
                      style={{ lineHeight: 1.35 }}
                    >
                      Mask requests as Claude Code CLI sessions. Anthropic only.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 py-1 cursor-pointer">
                  <Switch
                    checked={editingProvider.auto_compat || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, auto_compat: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-[12px] text-text">Auto Compat</div>
                    <div
                      className="font-body text-[11px] text-text-muted"
                      style={{ lineHeight: 1.35 }}
                    >
                      Use pi-ai registry reasoning and generation compatibility.
                    </div>
                  </div>
                </label>
              </div>

              {/* Right: inputs */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  justifyContent: 'center',
                }}
              >
                {/* GPU Profile */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    GPU Profile
                  </label>
                  <select
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    value={editingProvider.gpu_profile || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (!value) {
                        const resolved = resolveGpuParams('B200');
                        setEditingProvider({
                          ...editingProvider,
                          gpu_profile: undefined,
                          gpu_ram_gb: resolved.ram_gb,
                          gpu_bandwidth_tb_s: resolved.bandwidth_tb_s,
                          gpu_flops_tflop: resolved.flops_tflop,
                          gpu_power_draw_watts: resolved.power_draw_watts,
                        });
                      } else if (value === 'custom') {
                        const resolved = resolveGpuParams('custom', {
                          ram_gb: editingProvider.gpu_ram_gb,
                          bandwidth_tb_s: editingProvider.gpu_bandwidth_tb_s,
                          flops_tflop: editingProvider.gpu_flops_tflop,
                          power_draw_watts: editingProvider.gpu_power_draw_watts,
                        });
                        setEditingProvider({
                          ...editingProvider,
                          gpu_profile: 'custom',
                          gpu_ram_gb: resolved.ram_gb,
                          gpu_bandwidth_tb_s: resolved.bandwidth_tb_s,
                          gpu_flops_tflop: resolved.flops_tflop,
                          gpu_power_draw_watts: resolved.power_draw_watts,
                        });
                      } else {
                        const resolved = resolveGpuParams(value);
                        setEditingProvider({
                          ...editingProvider,
                          gpu_profile: value,
                          gpu_ram_gb: resolved.ram_gb,
                          gpu_bandwidth_tb_s: resolved.bandwidth_tb_s,
                          gpu_flops_tflop: resolved.flops_tflop,
                          gpu_power_draw_watts: resolved.power_draw_watts,
                        });
                      }
                    }}
                  >
                    <option value="">Default (B200)</option>
                    {GPU_PROFILE_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Discount */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Discount
                    <span className="font-normal text-[10px] text-text-muted ml-1">
                      e.g. 10 → pays 90%
                    </span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="w-full py-1 pl-2 pr-5 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={Math.round((editingProvider.discount ?? 0) * 100)}
                      onChange={(e) => {
                        const clamped = Math.min(100, Math.max(0, Number(e.target.value || '0')));
                        setEditingProvider({ ...editingProvider, discount: clamped / 100 });
                      }}
                    />
                    <span
                      className="font-body text-[11px] text-text-muted"
                      style={{
                        position: 'absolute',
                        right: '6px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                      }}
                    >
                      %
                    </span>
                  </div>
                </div>
                {/* Upstream Timeout */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Timeout
                    <span className="font-normal text-[10px] text-text-muted ml-1">1–3600s</span>
                  </label>
                  <input
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    min="1"
                    max="3600"
                    placeholder="Global default"
                    value={
                      editingProvider.timeoutMs != null
                        ? Math.round(editingProvider.timeoutMs / 1000)
                        : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setEditingProvider({ ...editingProvider, timeoutMs: undefined });
                      } else {
                        const seconds = Number(raw);
                        if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600) {
                          setEditingProvider({ ...editingProvider, timeoutMs: seconds * 1000 });
                        }
                      }
                    }}
                  />
                </div>
                {/* Max Concurrency */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Max Concurrency
                    <span className="font-normal text-[10px] text-text-muted ml-1">
                      across all models
                    </span>
                  </label>
                  <input
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                    type="number"
                    step="1"
                    min="1"
                    placeholder="No limit"
                    value={
                      editingProvider.maxConcurrency != null ? editingProvider.maxConcurrency : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setEditingProvider({ ...editingProvider, maxConcurrency: undefined });
                      } else {
                        const val = Number(raw);
                        if (Number.isFinite(val) && val >= 1) {
                          setEditingProvider({ ...editingProvider, maxConcurrency: val });
                        }
                      }
                    }}
                  />
                </div>
                {/* pi-ai Provider */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    pi-ai Provider
                  </label>
                  {!piProviderCustom ? (
                    <select
                      className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                      value={editingProvider.pi_ai_provider ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '__custom__') {
                          setPiProviderCustom(true);
                          return;
                        }
                        setEditingProvider({
                          ...editingProvider,
                          pi_ai_provider: raw || undefined,
                        });
                      }}
                    >
                      <option value="">— none —</option>
                      {piProviders.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value="__custom__">custom...</option>
                    </select>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className="flex-1 py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                        type="text"
                        placeholder="e.g. anthropic, openai"
                        value={editingProvider.pi_ai_provider ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setEditingProvider({
                            ...editingProvider,
                            pi_ai_provider: raw || undefined,
                          });
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="font-body text-[11px] text-text-muted hover:text-text px-1"
                        title="Back to list"
                        onClick={() => setPiProviderCustom(false)}
                      >
                        ↩
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Custom GPU fields — only when gpu_profile === 'custom' */}
          {editingProvider.gpu_profile === 'custom' && (
            <div
              className="border border-border-glass rounded-md p-2 bg-bg-subtle"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
            >
              <div className="flex flex-col gap-0.5">
                <label className="font-body text-[11px] font-medium text-text-secondary">
                  RAM (GB)
                </label>
                <input
                  className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  type="number"
                  step="1"
                  min="1"
                  placeholder="e.g. 80"
                  value={editingProvider.gpu_ram_gb || ''}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      gpu_ram_gb: parseFloat(e.target.value) || undefined,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="font-body text-[11px] font-medium text-text-secondary">
                  Bandwidth (TB/s)
                </label>
                <input
                  className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  type="number"
                  step="0.1"
                  min="0.1"
                  placeholder="e.g. 3.35"
                  value={editingProvider.gpu_bandwidth_tb_s || ''}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      gpu_bandwidth_tb_s: parseFloat(e.target.value) || undefined,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="font-body text-[11px] font-medium text-text-secondary">
                  FLOPS (TFLOPs)
                </label>
                <input
                  className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  type="number"
                  step="100"
                  min="1"
                  placeholder="e.g. 4000"
                  value={editingProvider.gpu_flops_tflop || ''}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      gpu_flops_tflop: parseFloat(e.target.value) || undefined,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="font-body text-[11px] font-medium text-text-secondary">
                  Power (Watts)
                </label>
                <input
                  className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  type="number"
                  step="10"
                  min="1"
                  placeholder="e.g. 700"
                  value={editingProvider.gpu_power_draw_watts || ''}
                  onChange={(e) =>
                    setEditingProvider({
                      ...editingProvider,
                      gpu_power_draw_watts: parseInt(e.target.value, 10) || undefined,
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
