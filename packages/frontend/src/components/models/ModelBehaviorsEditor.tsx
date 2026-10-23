import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type {
  Alias,
  AliasBehavior,
  CompactionSettings,
  InjectCacheControlBehavior,
} from '../../lib/api';
import { Badge } from '../ui/Badge';
import { DebouncedInput } from '../ui/DebouncedInput';
import { Switch } from '../ui/Switch';
import { AliasExtraBodyEditor } from './AliasExtraBodyEditor';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

/**
 * Prompt-cache behavior state: `auto` leaves the behavior out entirely (the
 * backend enables it on Anthropic-owned targets only), `on`/`off` are explicit.
 */
type CacheControlMode = 'auto' | 'on' | 'off';

export function ModelBehaviorsEditor({ editingAlias, setEditingAlias }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCompactionOpen, setIsCompactionOpen] = useState(false);

  const getBehavior = (type: AliasBehavior['type']): boolean => {
    return (editingAlias.advanced ?? []).some((b) => b.type === type && b.enabled !== false);
  };

  const setBehavior = (type: AliasBehavior['type'], enabled: boolean) => {
    const current = editingAlias.advanced ?? [];
    const without = current.filter((b) => b.type !== type);
    const next: AliasBehavior[] = enabled
      ? [...without, { type, enabled: true } as AliasBehavior]
      : without;
    setEditingAlias({ ...editingAlias, advanced: next });
  };

  const cacheControlBehavior = (editingAlias.advanced ?? []).find(
    (b): b is InjectCacheControlBehavior => b.type === 'inject_cache_control'
  );

  // Three states: absent = auto (the backend enables it on Anthropic-owned
  // targets only), explicitly on, or explicitly off. Sub-fields are only
  // editable while it is explicitly on, so editing a value can never silently
  // force it on for an upstream that rejects cache_control.
  const cacheControlMode: CacheControlMode = !cacheControlBehavior
    ? 'auto'
    : cacheControlBehavior.enabled === false
      ? 'off'
      : 'on';

  const updateCacheControl = (patch: Partial<InjectCacheControlBehavior>) => {
    const next: AliasBehavior[] = (editingAlias.advanced ?? []).map((b) =>
      b.type === 'inject_cache_control' ? { ...b, ...patch } : b
    );
    setEditingAlias({ ...editingAlias, advanced: next });
  };

  const setCacheControlMode = (mode: CacheControlMode) => {
    const current = editingAlias.advanced ?? [];
    if (mode === 'auto') {
      setEditingAlias({
        ...editingAlias,
        advanced: current.filter((b) => b.type !== 'inject_cache_control'),
      });
      return;
    }

    const enabled = mode === 'on';
    const hasEntry = current.some((b) => b.type === 'inject_cache_control');
    const next: AliasBehavior[] = hasEntry
      ? current.map((b) => (b.type === 'inject_cache_control' ? { ...b, enabled } : b))
      : [...current, { type: 'inject_cache_control', enabled }];
    setEditingAlias({ ...editingAlias, advanced: next });
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
          className="border-border-glass border-t px-3 py-3"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {/* ── Behaviors ── */}
          <div>
            <label
              className="font-body text-text-secondary text-[13px] font-medium"
              style={{ display: 'block', marginBottom: '6px' }}
            >
              Behaviors
            </label>
            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-text text-[13px]">Strip Adaptive Thinking</span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  On the <code className="text-primary">/v1/messages</code> path, remove{' '}
                  <code className="text-primary">thinking</code> when set to{' '}
                  <code className="text-primary">adaptive</code> so the provider uses its default
                  behaviour.
                </p>
              </div>
              <Switch
                checked={getBehavior('strip_adaptive_thinking')}
                onChange={(val) => setBehavior('strip_adaptive_thinking', val)}
                size="sm"
              />
            </div>

            <div className="flex items-start justify-between gap-3 py-1">
              <div>
                <span className="font-body text-text text-[13px]">Prompt Cache Breakpoints</span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  Add Anthropic <code className="text-primary">cache_control</code> breakpoints to
                  chat/responses requests that are translated to the Messages API: last tool, last
                  system block, and the conversation tail. Without them, translated requests never
                  hit the prompt cache. <strong>Auto</strong> enables it where the target is
                  Anthropic&apos;s own API; <strong>On</strong> forces it for other Messages-
                  compatible upstreams (only where they accept{' '}
                  <code className="text-primary">cache_control</code>), and <strong>Off</strong>{' '}
                  disables it. Native Messages clients keep their own breakpoints.
                </p>
              </div>
              <select
                aria-label="Prompt cache breakpoints"
                className="font-body text-text bg-bg-glass border-border-glass focus:border-primary mt-0.5 shrink-0 rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                value={cacheControlMode}
                onChange={(e) => setCacheControlMode(e.target.value as CacheControlMode)}
              >
                <option value="auto">Auto</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>

            {cacheControlMode === 'on' && (
              <div className="grid grid-cols-2 gap-1.5 pb-1">
                <div>
                  <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                    Cache TTL
                  </label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                    value={cacheControlBehavior?.ttl ?? ''}
                    onChange={(e) =>
                      updateCacheControl({
                        ttl: e.target.value === '' ? undefined : (e.target.value as '5m' | '1h'),
                      })
                    }
                  >
                    <option value="">Default (5m)</option>
                    <option value="1h">1 hour (2x write)</option>
                  </select>
                </div>
                <div>
                  <label className="font-body text-text-secondary mb-1 block text-[11px] font-medium">
                    Trailing breakpoints
                    <span className="text-text-muted ml-1 text-[10px] font-normal">0–4</span>
                  </label>
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
                    value={String(cacheControlBehavior?.message_breakpoints ?? 2)}
                    onChange={(e) =>
                      updateCacheControl({ message_breakpoints: Number(e.target.value) })
                    }
                  >
                    <option value="0">0 (static prefix only)</option>
                    <option value="1">1 (current turn)</option>
                    <option value="2">2 (current + previous)</option>
                    <option value="3">3 (current + previous 2)</option>
                    <option value="4">4 (current + previous 3)</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-text text-[13px]">Vision Fallthrough</span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  If the request contains images and the target model is text-only, use the
                  descriptor model to convert images to text.
                </p>
              </div>
              <Switch
                checked={editingAlias.use_image_fallthrough || false}
                onChange={(val) => setEditingAlias({ ...editingAlias, use_image_fallthrough: val })}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-text text-[13px]">Enforce Limits</span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  Reject oversized prompts locally (400 context_length_exceeded) before dispatch.
                  Uses a fast heuristic estimator with a 10% safety margin, and reserves the smaller
                  of max_tokens and the model&apos;s max completion for the response. Requires a
                  known context_length in metadata (override or catalog).
                </p>
              </div>
              <Switch
                checked={editingAlias.enforce_limits || false}
                onChange={(val) => setEditingAlias({ ...editingAlias, enforce_limits: val })}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-text text-[13px]">Sticky Session</span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  For multi-turn conversations, prefer the same provider/model used on the previous
                  turn (when still healthy) for better prompt-cache hit rates and consistent model
                  behaviour. Session continuity is tracked in memory only.
                </p>
              </div>
              <Switch
                checked={editingAlias.sticky_session ?? true}
                onChange={(val) => setEditingAlias({ ...editingAlias, sticky_session: val })}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-text text-[13px]">
                  Synthetic Auto Mode Approval
                </span>
                <p className="font-body text-text-muted mt-0.5 text-[11px]">
                  For translated (non-Anthropic) targets, answer Claude Code safeguards requests
                  with a synthetic not_flagged verdict that states no real classifier ran. Opt-in
                  only; off by default.
                </p>
              </div>
              <Switch
                checked={editingAlias.synthetic_safeguard_approval || false}
                onChange={(val) =>
                  setEditingAlias({ ...editingAlias, synthetic_safeguard_approval: val })
                }
                size="sm"
              />
            </div>
          </div>

          <div className="bg-border-glass h-px"></div>

          {/* ── Extra Body Fields ── */}
          <AliasExtraBodyEditor editingAlias={editingAlias} setEditingAlias={setEditingAlias} />

          <div className="bg-border-glass h-px"></div>

          {/* ── Compaction Override ── */}
          <div>
            <button
              type="button"
              className="mb-1 flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
              onClick={() => setIsCompactionOpen(!isCompactionOpen)}
              aria-expanded={isCompactionOpen}
            >
              {isCompactionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span
                className="font-body text-text-secondary text-[13px] font-medium"
                style={{ marginBottom: 0 }}
              >
                Compaction Override
              </span>
              {editingAlias.compaction &&
                Object.values(editingAlias.compaction).some((v) => v != null) && (
                  <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                    Custom
                  </Badge>
                )}
            </button>
            {isCompactionOpen && (
              <div
                className="border-border-glass rounded-md border"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '8px',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <div
                  className="font-body text-text-secondary text-[11px]"
                  style={{ lineHeight: 1.35 }}
                >
                  Override global context-compaction for this alias. Empty = inherit (alias
                  overrides provider overrides global). Nested native/headroom settings are
                  configurable on the global Config page only (v1).
                </div>
                {/* enabled tri-state */}
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
                      editingAlias.compaction?.enabled == null
                        ? ''
                        : editingAlias.compaction.enabled
                          ? 'true'
                          : 'false'
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      const enabled: boolean | undefined = raw === '' ? undefined : raw === 'true';
                      setEditingAlias({
                        ...editingAlias,
                        compaction: {
                          ...editingAlias.compaction,
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
                    value={editingAlias.compaction?.strategy ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const strategy = (raw || undefined) as CompactionSettings['strategy'];
                      setEditingAlias({
                        ...editingAlias,
                        compaction: {
                          ...editingAlias.compaction,
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
                        editingAlias.compaction?.triggerRatio != null
                          ? String(editingAlias.compaction.triggerRatio)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const triggerRatio = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingAlias({
                          ...editingAlias,
                          compaction: {
                            ...editingAlias.compaction,
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
                        editingAlias.compaction?.absoluteTriggerTokens != null
                          ? String(editingAlias.compaction.absoluteTriggerTokens)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const absoluteTriggerTokens =
                          val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingAlias({
                          ...editingAlias,
                          compaction: {
                            ...editingAlias.compaction,
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
                        editingAlias.compaction?.minTokens != null
                          ? String(editingAlias.compaction.minTokens)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const minTokens = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingAlias({
                          ...editingAlias,
                          compaction: {
                            ...editingAlias.compaction,
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
                        editingAlias.compaction?.protectRecent != null
                          ? String(editingAlias.compaction.protectRecent)
                          : ''
                      }
                      onChange={(val: string) => {
                        const num = Number(val);
                        const protectRecent = val === '' || !Number.isFinite(num) ? undefined : num;
                        setEditingAlias({
                          ...editingAlias,
                          compaction: {
                            ...editingAlias.compaction,
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
        </div>
      )}
    </div>
  );
}
