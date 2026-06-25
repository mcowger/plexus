import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { Badge } from '../ui/Badge';
import { DebouncedInput } from '../ui/DebouncedInput';
import { ModelArchitectureEditor } from './ModelArchitectureEditor';
import { AliasExtraBodyEditor } from './AliasExtraBodyEditor';
import type { Alias, AliasBehavior, CompactionSettings } from '../../lib/api';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

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
          className="px-3 py-3 border-t border-border-glass"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {/* ── Behaviors ── */}
          <div>
            <label
              className="font-body text-[13px] font-medium text-text-secondary"
              style={{ display: 'block', marginBottom: '6px' }}
            >
              Behaviors
            </label>
            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-[13px] text-text">Strip Adaptive Thinking</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
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

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-[13px] text-text">Vision Fallthrough</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
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
                <span className="font-body text-[13px] text-text">Enforce Limits</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
                  Reject oversized prompts locally (400 context_length_exceeded) before dispatch.
                  Uses a fast heuristic estimator with a 10% safety margin, and reserves the smaller
                  of max_tokens and the model&apos;s max completion for the response. Requires a
                  known context_length in metadata (override or catalog).
                </p>
                {editingAlias.enforce_limits &&
                  !editingAlias.metadata?.overrides?.context_length &&
                  !editingAlias.metadata?.overrides?.top_provider?.context_length && (
                    <p
                      className="font-body text-[11px] mt-1 flex items-center gap-1"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      <AlertTriangle size={12} />
                      No context_length found in metadata - this toggle will have no effect until a
                      metadata source with a known context_length is configured.
                    </p>
                  )}
              </div>
              <Switch
                checked={editingAlias.enforce_limits || false}
                onChange={(val) => setEditingAlias({ ...editingAlias, enforce_limits: val })}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-[13px] text-text">Sticky Session</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
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
          </div>

          <div className="h-px bg-border-glass"></div>

          {/* ── Model Architecture ── */}
          <ModelArchitectureEditor editingAlias={editingAlias} setEditingAlias={setEditingAlias} />

          <div className="h-px bg-border-glass"></div>

          {/* ── Extra Body Fields ── */}
          <AliasExtraBodyEditor editingAlias={editingAlias} setEditingAlias={setEditingAlias} />

          <div className="h-px bg-border-glass"></div>

          {/* ── Compaction Override ── */}
          <div>
            <div
              className="flex items-center gap-2 cursor-pointer mb-1"
              onClick={() => setIsCompactionOpen(!isCompactionOpen)}
            >
              {isCompactionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <label
                className="font-body text-[13px] font-medium text-text-secondary cursor-pointer"
                style={{ marginBottom: 0 }}
              >
                Compaction Override
              </label>
              {editingAlias.compaction &&
                Object.values(editingAlias.compaction).some((v) => v != null) && (
                  <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
                    Custom
                  </Badge>
                )}
            </div>
            {isCompactionOpen && (
              <div
                className="border border-border-glass rounded-md"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '8px',
                  background: 'var(--color-bg-subtle)',
                }}
              >
                <div
                  className="font-body text-[11px] text-text-secondary"
                  style={{ lineHeight: 1.35 }}
                >
                  Override global context-compaction for this alias. Empty = inherit (alias
                  overrides provider overrides global). Nested native/headroom settings are
                  configurable on the global Config page only (v1).
                </div>
                {/* enabled tri-state */}
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
                  <label className="font-body text-[11px] font-medium text-text-secondary">
                    Strategy
                    <span className="font-normal text-[10px] text-text-muted ml-1">
                      native | headroom
                    </span>
                  </label>
                  <select
                    className="w-full py-1 pl-2 pr-2 font-body text-[12px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
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
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
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
                    <label className="font-body text-[11px] font-medium text-text-secondary block mb-1">
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
