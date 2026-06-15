import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { ModelArchitectureEditor } from './ModelArchitectureEditor';
import { AliasExtraBodyEditor } from './AliasExtraBodyEditor';
import type { Alias, AliasBehavior } from '../../lib/api';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

export function ModelBehaviorsEditor({ editingAlias, setEditingAlias }: Props) {
  const [isOpen, setIsOpen] = useState(false);

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
                checked={editingAlias.sticky_session || false}
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
        </div>
      )}
    </div>
  );
}
