import {
  getDefaultCacheKeyInjection,
  isOAuthPlaceholderUrl,
  PROVIDER_CACHE_KEY_INJECTION_OPTIONS,
  type ProviderCacheKeyInjection,
} from '@plexus/shared';
import { ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { CompactionSettings, Provider } from '../../lib/api';
import { api } from '../../lib/api';
import {
  collectProviderEndpointUrls,
  isOAuthProviderDraft,
  PI_AI_AUTO_VALUE,
} from '../../lib/piAiProvider';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { DebouncedInput } from '../ui/DebouncedInput';
import { Switch } from '../ui/Switch';
import { Tooltip } from '../ui/Tooltip';
import {
  getAdapterName,
  KNOWN_ADAPTERS,
  normalizeAdapterEntries,
} from './model-editor/adapter-utils';
import { ProviderQuirksModal } from './ProviderQuirksModal';
import { ReasoningRewriteRulesEditor } from './ReasoningRewriteRulesEditor';

export { KNOWN_ADAPTERS } from './model-editor/adapter-utils';

const ANTHROPIC_TOOL_ID_ADAPTER = 'normalize_anthropic_tool_ids';

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
  const [quirksModalOpen, setQuirksModalOpen] = useState(false);
  const [piProviderResolving, setPiProviderResolving] = useState(false);

  useEffect(() => {
    api
      .getPiProviders()
      .then(setPiProviders)
      .catch(() => {
        /* non-fatal — custom quirks remain available */
      });
  }, []);

  // Resolve `- auto -` to the concrete pi-ai provider matching the current
  // endpoint URLs / OAuth provider (same lookup as new-provider auto-detect).
  // `- auto -` is never a stored selection: it immediately becomes the
  // resolved entry (or stays unchanged when nothing matches).
  const resolvePiAiAuto = async () => {
    const urls = collectProviderEndpointUrls(editingProvider.apiBaseUrl);
    const oauthProvider = isOAuthProviderDraft(editingProvider.apiBaseUrl)
      ? editingProvider.oauthProvider?.trim() || undefined
      : undefined;
    setPiProviderResolving(true);
    try {
      const resolved = await api.resolvePiAiProvider({ urls, oauthProvider });
      if (resolved) {
        setEditingProvider((prev) => ({
          ...prev,
          pi_ai_provider: resolved,
          auto_compat: true,
        }));
      }
    } catch {
      // non-fatal — leave the previous selection in place
    } finally {
      setPiProviderResolving(false);
    }
  };

  return (
    <div className="border-border-glass overflow-hidden rounded-sm border">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="bg-bg-subtle hover:bg-bg-hover flex w-full items-center justify-between px-3 py-2 text-left transition-colors duration-150"
      >
        <span className="font-body text-text-secondary text-[13px] font-medium">Advanced</span>
        {isOpen ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-text-muted" />
        )}
      </button>
      {isOpen && (
        <div
          className="border-border-glass border-t px-3 py-2"
          style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
        >
          {/* Model Autosync */}
          <div className="border-border-glass overflow-hidden rounded-md border">
            <div className="bg-bg-hover flex flex-wrap items-center gap-3 p-2 px-3">
              <label className="flex min-w-[190px] flex-1 cursor-pointer items-center gap-2">
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
                <span className="font-body text-text-secondary text-[12px] font-medium">
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
                <span className="font-body text-text-secondary text-[11px] whitespace-nowrap">
                  Sync Interval Minutes
                </span>
              </div>
            </div>
          </div>

          {/* Provider Adapters */}
          <div className="border-border-glass overflow-hidden rounded-md border">
            <div
              className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3"
              onClick={() => setIsAdaptersOpen(!isAdaptersOpen)}
            >
              {isAdaptersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-text-secondary text-[12px] font-medium"
                style={{ marginBottom: 0, flex: 1 }}
              >
                Provider Adapters
              </label>
              {normalizeAdapterEntries(editingProvider.adapter).length > 0 && (
                <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                  {normalizeAdapterEntries(editingProvider.adapter).length}
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
                  className="font-body text-text-secondary mb-2 text-[11px]"
                  style={{ lineHeight: 1.4 }}
                >
                  Adapters rewrite requests and responses to fix provider-specific field-name
                  incompatibilities. Applied to every model under this provider unless overridden
                  per-model.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                  {KNOWN_ADAPTERS.filter(
                    (a) => a.value !== 'model_override' && a.value !== 'web_search_coercion'
                  ).map((a) => {
                    const adapterEntries = normalizeAdapterEntries(editingProvider.adapter);
                    const active = adapterEntries.some((e: any) => getAdapterName(e) === a.value);
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
                            const current = normalizeAdapterEntries(editingProvider.adapter);
                            const next = active
                              ? current.filter((e: any) => getAdapterName(e) !== a.value)
                              : [...current, { name: a.value, options: {} }];
                            setEditingProvider({ ...editingProvider, adapter: next });
                          }}
                        />
                        <div>
                          <div className="font-body text-text text-[12px] font-medium">
                            {a.label}
                          </div>
                          <div
                            className="font-body text-text-secondary text-[11px]"
                            style={{ lineHeight: 1.35 }}
                          >
                            {a.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Reasoning Rewrite rules editor (shared with per-model UI) */}
                <ReasoningRewriteRulesEditor
                  adapters={normalizeAdapterEntries(editingProvider.adapter)}
                  onChange={(next: any[]) =>
                    setEditingProvider({ ...editingProvider, adapter: next })
                  }
                />

                {/* Web Search Coercion — inline options editor */}
                {(() => {
                  const adapterEntries = normalizeAdapterEntries(editingProvider.adapter);
                  const entry = adapterEntries.find(
                    (e: any) => getAdapterName(e) === 'web_search_coercion'
                  );
                  const active = !!entry;
                  const currentTarget: string =
                    typeof entry === 'string' ? '' : (entry?.options?.target ?? '');
                  const currentMaxUses: string =
                    typeof entry === 'string' || entry?.options?.max_uses == null
                      ? ''
                      : String(entry.options.max_uses);

                  const toggleActive = () => {
                    const current = normalizeAdapterEntries(editingProvider.adapter);
                    const next = active
                      ? current.filter((e: any) => getAdapterName(e) !== 'web_search_coercion')
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
                    const current = normalizeAdapterEntries(editingProvider.adapter);
                    const next = current.map((e: any) => {
                      const name = getAdapterName(e);
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
                          <div className="font-body text-text text-[12px] font-medium">
                            Web Search Coercion
                          </div>
                          <div
                            className="font-body text-text-secondary text-[11px]"
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
                            <label className="font-body text-text-secondary text-[11px] font-medium">
                              Target Format
                            </label>
                            <select
                              className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
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
                              <label className="font-body text-text-secondary text-[11px] font-medium">
                                Max Uses
                                <span className="text-text-muted ml-1 text-[10px] font-normal">
                                  optional
                                </span>
                              </label>
                              <input
                                className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                                type="number"
                                min="1"
                                step="1"
                                placeholder="No limit"
                                value={currentMaxUses}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === '') {
                                    // Remove max_uses from options
                                    const current = normalizeAdapterEntries(
                                      editingProvider.adapter
                                    );
                                    const next = current.map((e2: any) => {
                                      const name = getAdapterName(e2);
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

                {/* Anthropic Tool-ID Normalization — Auto | Enabled | Disabled */}
                {(() => {
                  const entries = normalizeAdapterEntries(editingProvider.adapter);
                  // The backend replays adapter entries in order, so a LATER
                  // entry overrides an earlier one — read the last match, not
                  // the first (resolveAdapters, adapter-resolver.ts).
                  let entry: any;
                  for (const candidate of entries) {
                    const name = getAdapterName(candidate);
                    if (name === ANTHROPIC_TOOL_ID_ADAPTER) entry = candidate;
                  }
                  const mode: 'auto' | 'on' | 'off' = !entry
                    ? 'auto'
                    : typeof entry === 'string' || entry.enabled !== false
                      ? 'on'
                      : 'off';

                  const setMode = (value: 'auto' | 'on' | 'off') => {
                    const withoutEntry = entries.filter(
                      (e: any) => getAdapterName(e) !== ANTHROPIC_TOOL_ID_ADAPTER
                    );
                    const next =
                      value === 'auto'
                        ? withoutEntry
                        : [
                            ...withoutEntry,
                            {
                              name: ANTHROPIC_TOOL_ID_ADAPTER,
                              options: {},
                              enabled: value === 'on',
                            },
                          ];
                    setEditingProvider({ ...editingProvider, adapter: next });
                  };

                  // Advisory mirror of the backend gate (adapter-resolver.ts):
                  // it only fires on the Messages wire format, so a record base
                  // URL counts only where the Messages dispatch would go — a
                  // chat-only anthropic.com entry never receives one. A string
                  // base URL containing anthropic.com IS a Messages provider by
                  // inference (getProviderTypes), so it counts as-is.
                  const isAnthropicUrl = (url: string) => {
                    const lowered = url.trim().toLowerCase();
                    return (
                      lowered.includes('anthropic.com') ||
                      (isOAuthPlaceholderUrl(url) &&
                        (editingProvider.oauthProvider || editingProvider.id) === 'anthropic')
                    );
                  };
                  const baseUrls = editingProvider.apiBaseUrl;
                  const autoDetected =
                    editingProvider.useClaudeMasking === true ||
                    (typeof baseUrls === 'string'
                      ? isAnthropicUrl(baseUrls)
                      : Object.entries(baseUrls ?? {}).some(([key, value]) => {
                          const type = key.toLowerCase();
                          return (
                            (type === 'messages' || type.startsWith('messages:')) &&
                            typeof value === 'string' &&
                            isAnthropicUrl(value)
                          );
                        }));

                  return (
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-glass)',
                        background:
                          mode === 'auto' ? 'var(--color-bg-glass)' : 'var(--color-bg-hover)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <div className="font-body text-text text-[12px] font-medium">
                            Anthropic Tool-ID Normalization
                          </div>
                          <Tooltip
                            position="top"
                            content={
                              <div className="font-body w-64 leading-relaxed whitespace-normal">
                                Auto enables this only for Anthropic-like targets on this provider's
                                Messages endpoint: base URL containing anthropic.com, Anthropic
                                OAuth, or Claude masking. Choose Enabled to force it for
                                Anthropic-compatible gateways on other hosts.
                              </div>
                            }
                          >
                            <button
                              type="button"
                              aria-label="About Anthropic Tool-ID Normalization"
                              className="text-text-muted hover:bg-bg-hover hover:text-text-secondary focus-visible:ring-primary flex h-4 w-4 items-center justify-center rounded-full transition-colors focus-visible:ring-1 focus-visible:outline-none"
                            >
                              <Info size={12} />
                            </button>
                          </Tooltip>
                        </div>
                        <div
                          className="font-body text-text-secondary text-[11px]"
                          style={{ lineHeight: 1.35 }}
                        >
                          Rewrites tool ids that violate Anthropic's ^[a-zA-Z0-9_-]+$ charset before
                          dispatch. Anthropic rejects such ids with HTTP 400.
                        </div>
                      </div>
                      <select
                        className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                        value={mode === 'auto' ? '' : mode}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setMode(raw === 'on' ? 'on' : raw === 'off' ? 'off' : 'auto');
                        }}
                      >
                        <option value="">{`Auto (currently: ${autoDetected ? 'enabled' : 'disabled'})`}</option>
                        <option value="on">Enabled</option>
                        <option value="off">Disabled</option>
                      </select>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Stall Detection Overrides — with Cooldown on Stall toggle in header */}
          <div className="border-border-glass overflow-hidden rounded-md border">
            <div
              className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3"
              onClick={() => setIsStallOpen(!isStallOpen)}
            >
              {isStallOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-text-secondary text-[12px] font-medium"
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
                <span className="font-body text-text-secondary text-[11px] whitespace-nowrap">
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
                  className="font-body text-text-secondary text-[11px]"
                  style={{ lineHeight: 1.35 }}
                >
                  Override the global stall detection settings for this provider. Leave empty to use
                  the global setting for each field.
                </div>
                {/* Stall inputs — two-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {/* TTFB Timeout */}
                  <div>
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      TTFB Timeout (s)
                      <span className="text-text-muted ml-1 text-[10px] font-normal">5–120</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      TTFB Byte Threshold
                      <span className="text-text-muted ml-1 text-[10px] font-normal">50–10k</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      Min Bytes/Sec
                      <span className="text-text-muted ml-1 text-[10px] font-normal">50–5k</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      Stall Window (s)
                      <span className="text-text-muted ml-1 text-[10px] font-normal">3–30</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      Grace Period (s)
                      <span className="text-text-muted ml-1 text-[10px] font-normal">0–120</span>
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
          <div className="border-border-glass overflow-hidden rounded-md border">
            <button
              type="button"
              className="bg-bg-hover hover:bg-bg-glass flex w-full cursor-pointer items-center gap-2 border-0 p-2 px-3 text-left"
              onClick={() => setIsCompactionOpen(!isCompactionOpen)}
              aria-expanded={isCompactionOpen}
            >
              {isCompactionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span
                className="font-body text-text-secondary text-[12px] font-medium"
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
                  className="font-body text-text-secondary text-[11px]"
                  style={{ lineHeight: 1.35 }}
                >
                  Override global context-compaction for this provider. Empty = inherit. Nested
                  native/headroom settings are configurable on the global Config page only (v1).
                </div>
                {/* enabled tri-state: Inherit | On | Off */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Enabled
                    <span className="text-text-muted ml-1 text-[10px] font-normal">
                      Inherit / On / Off
                    </span>
                  </label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
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
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Strategy
                    <span className="text-text-muted ml-1 text-[10px] font-normal">
                      native | headroom
                    </span>
                  </label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      Trigger Ratio
                      <span className="text-text-muted ml-1 text-[10px] font-normal">0–1</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                      Abs. Trigger Tokens
                      <span className="text-text-muted ml-1 text-[10px] font-normal">optional</span>
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
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
                    <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
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
          <div className="border-border-glass overflow-hidden rounded-md border">
            <div
              className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3"
              onClick={() => setIsHeadersOpen(!isHeadersOpen)}
            >
              {isHeadersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-text-secondary text-[12px] font-medium"
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
                  <div className="font-body text-text-secondary text-[11px] italic">
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
          <div className="border-border-glass overflow-hidden rounded-md border">
            <div
              className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3"
              onClick={() => setIsExtraBodyOpen(!isExtraBodyOpen)}
            >
              {isExtraBodyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-text-secondary text-[12px] font-medium"
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
                  <div className="font-body text-text-secondary text-[11px] italic">
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

          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-2 py-1">
              <Switch
                checked={editingProvider.rawPassthrough?.enabled === true}
                onChange={(enabled) =>
                  setEditingProvider({
                    ...editingProvider,
                    rawPassthrough: {
                      enabled,
                      baseUrl: editingProvider.rawPassthrough?.baseUrl || '',
                      auth: editingProvider.rawPassthrough?.auth || 'bearer',
                    },
                  })
                }
              />
              <div>
                <div className="font-body text-text text-[12px]">Enable Raw Passthrough</div>
                <div className="font-body text-text-muted text-[11px]" style={{ lineHeight: 1.35 }}>
                  Exposes this provider at <code>/raw/{editingProvider.id || 'provider'}/*</code> to
                  explicitly authorized keys. Requests bypass routing and all transformations.
                </div>
              </div>
            </label>
            {editingProvider.rawPassthrough?.enabled && (
              <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-[1fr_180px]">
                <DebouncedInput
                  label="Raw Upstream Base URL"
                  value={editingProvider.rawPassthrough.baseUrl}
                  placeholder="https://openrouter.ai/api"
                  onChange={(baseUrl) =>
                    setEditingProvider({
                      ...editingProvider,
                      rawPassthrough: { ...editingProvider.rawPassthrough!, baseUrl },
                    })
                  }
                />
                <div className="flex flex-col gap-1">
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Provider Authentication
                  </label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border px-2 py-2 text-[12px] outline-none"
                    value={editingProvider.rawPassthrough.auth}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        rawPassthrough: {
                          ...editingProvider.rawPassthrough!,
                          auth: e.target.value as 'bearer' | 'x-api-key' | 'x-goog-api-key',
                        },
                      })
                    }
                  >
                    <option value="bearer">Authorization: Bearer</option>
                    <option value="x-api-key">x-api-key</option>
                    <option value="x-goog-api-key">x-goog-api-key</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Compact settings card — toggles left, value inputs right. Single
              column on phones: two fixed `1fr` tracks made the right column's
              selects wider than the modal, clipping them horizontally. */}
          <div className="border-border-glass bg-bg-subtle rounded-md border p-2">
            <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
              {/* Left: toggles */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <Switch
                    checked={editingProvider.estimateTokens || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, estimateTokens: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-text text-[12px]">Estimate Tokens</div>
                    <div
                      className="font-body text-text-muted text-[11px]"
                      style={{ lineHeight: 1.35 }}
                    >
                      Only when provider doesn't return usage data. Use sparingly.
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <Switch
                    checked={editingProvider.disableCooldown || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, disableCooldown: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-text text-[12px]">Disable Cooldowns</div>
                    <div
                      className="font-body text-text-muted text-[11px]"
                      style={{ lineHeight: 1.35 }}
                    >
                      Provider will never be placed on cooldown.
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <Switch
                    checked={editingProvider.allow100PercentUtilization || false}
                    onChange={(checked) =>
                      setEditingProvider({
                        ...editingProvider,
                        allow100PercentUtilization: checked,
                      })
                    }
                  />
                  <div>
                    <div className="font-body text-text text-[12px]">Allow 100% Utilization</div>
                    <div
                      className="font-body text-text-muted text-[11px]"
                      style={{ lineHeight: 1.35 }}
                    >
                      Allow quota usage to reach 100% instead of cooling down at 99%. May result in
                      repeat attempts or failed generations.
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <Switch
                    checked={editingProvider.useClaudeMasking || false}
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, useClaudeMasking: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-text text-[12px]">Use Claude Masking</div>
                    <div
                      className="font-body text-text-muted text-[11px]"
                      style={{ lineHeight: 1.35 }}
                    >
                      Mask requests as Claude Code CLI sessions. Anthropic only.
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2 py-1">
                  <Switch
                    checked={editingProvider.auto_compat || false}
                    disabled={
                      !editingProvider.pi_ai_provider &&
                      !editingProvider.pi_ai_quirks &&
                      !editingProvider.auto_compat
                    }
                    onChange={(checked) =>
                      setEditingProvider({ ...editingProvider, auto_compat: checked })
                    }
                  />
                  <div>
                    <div className="font-body text-text text-[12px]">Auto Compat</div>
                    <div
                      className="font-body text-text-muted text-[11px]"
                      style={{ lineHeight: 1.35 }}
                    >
                      Translates reasoning and generation options using pi-ai capabilities and
                      explicit quirks. Builtin models resolve by Model ID or an exact catalog match;
                      quirks can overlay them or work independently.
                    </div>
                  </div>
                </label>
                <div className="flex flex-col gap-1 py-1">
                  <label className="font-body text-text text-[12px]">Cache Key Injection</label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                    value={
                      editingProvider.cacheKeyInjection ??
                      getDefaultCacheKeyInjection(editingProvider.oauthProvider) ??
                      'off'
                    }
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        cacheKeyInjection: e.target.value as ProviderCacheKeyInjection,
                      })
                    }
                  >
                    {PROVIDER_CACHE_KEY_INJECTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div
                    className="font-body text-text-muted text-[11px]"
                    style={{ lineHeight: 1.35 }}
                  >
                    Inject Plexus's derived per-run cache/session key into this field so upstream
                    prompt-cache routing doesn't depend on the client. Meta OAuth defaults to
                    prompt_cache_key.
                  </div>
                </div>
              </div>
              {/* Right: inputs */}
              <div className="flex min-w-0 flex-col justify-center gap-1.5">
                {/* Discount */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Discount
                    <span className="text-text-muted ml-1 text-[10px] font-normal">
                      e.g. 10 → pays 90%
                    </span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-5 pl-2 text-[12px] outline-none"
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
                      className="font-body text-text-muted text-[11px]"
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
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Timeout
                    <span className="text-text-muted ml-1 text-[10px] font-normal">1–3600s</span>
                  </label>
                  <input
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
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
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Max Concurrency
                    <span className="text-text-muted ml-1 text-[10px] font-normal">
                      across all models
                    </span>
                  </label>
                  <input
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
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
                {/* Provider Quirks */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-body text-text-secondary text-[11px] font-medium">
                    Provider Quirks
                    {editingProvider.pi_ai_quirks && (
                      <span className="text-primary ml-1 text-[10px] font-normal">+ custom</span>
                    )}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label="Provider Quirks"
                      className="font-body text-text bg-bg-glass border-border-glass focus:border-primary min-w-0 flex-1 rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                      value={
                        editingProvider.pi_ai_provider ??
                        (editingProvider.pi_ai_quirks ? '__custom__' : '')
                      }
                      disabled={piProviderResolving}
                      title={
                        piProviderResolving
                          ? 'Resolving pi-ai provider…'
                          : 'Pick - auto - to detect from the endpoint URLs or OAuth provider'
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === '__custom__') {
                          setQuirksModalOpen(true);
                          return;
                        }
                        if (raw === PI_AI_AUTO_VALUE) {
                          void resolvePiAiAuto();
                          return;
                        }
                        setEditingProvider({
                          ...editingProvider,
                          pi_ai_provider: raw || undefined,
                          auto_compat:
                            raw || editingProvider.pi_ai_quirks
                              ? editingProvider.auto_compat
                              : false,
                        });
                      }}
                    >
                      <option value="">— none —</option>
                      <option value={PI_AI_AUTO_VALUE}>- auto -</option>
                      {editingProvider.pi_ai_provider &&
                        !piProviders.includes(editingProvider.pi_ai_provider) && (
                          <option value={editingProvider.pi_ai_provider}>
                            {editingProvider.pi_ai_provider}
                          </option>
                        )}
                      {piProviders.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value="__custom__">custom...</option>
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setQuirksModalOpen(true)}
                    >
                      Edit
                    </Button>
                  </div>
                  <span className="font-body text-text-muted text-[10px]">
                    Built-in pi-ai traits with optional custom protocol and model overrides layered
                    on top, plus Native Responses Extensions. Custom quirks never replace the
                    built-in selection. Enable Auto Compat to apply quirks to requests.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <ProviderQuirksModal
        isOpen={quirksModalOpen}
        onClose={() => setQuirksModalOpen(false)}
        quirks={editingProvider.pi_ai_quirks}
        responsesExtensions={editingProvider.responsesExtensions}
        oauthProvider={editingProvider.oauthProvider}
        apiBaseUrl={editingProvider.apiBaseUrl}
        onApply={({ quirks, responsesExtensions }) => {
          setEditingProvider((prev) => ({
            ...prev,
            // Custom quirks are an overlay: they layer onto the built-in pi-ai
            // provider (or stand alone when none is selected) and applying them
            // never clears that selection.
            pi_ai_quirks: quirks,
            responsesExtensions,
            auto_compat: quirks || prev.pi_ai_provider ? prev.auto_compat : false,
          }));
          setQuirksModalOpen(false);
        }}
      />
    </div>
  );
}
