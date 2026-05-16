import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Trans } from 'react-i18next';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';
import type { Alias, AliasBehavior } from '../../lib/api';
import { useT } from '../../i18n';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

export function ModelBehaviorsEditor({ editingAlias, setEditingAlias }: Props) {
  const { t } = useT('models.behaviorsEditor');
  const [isOpen, setIsOpen] = useState(false);

  const getBehavior = (behaviorType: AliasBehavior['type']): boolean => {
    return (editingAlias.advanced ?? []).some((b) => b.type === behaviorType && b.enabled !== false);
  };

  const setBehavior = (behaviorType: AliasBehavior['type'], enabled: boolean) => {
    const current = editingAlias.advanced ?? [];
    const without = current.filter((b) => b.type !== behaviorType);
    const next: AliasBehavior[] = enabled
      ? [...without, { type: behaviorType, enabled: true } as AliasBehavior]
      : without;
    setEditingAlias({ ...editingAlias, advanced: next });
  };

  const addAlias = () => {
    setEditingAlias({
      ...editingAlias,
      aliases: [...(editingAlias.aliases || []), ''],
    });
  };

  const updateAlias = (index: number, value: string) => {
    const newAliases = [...(editingAlias.aliases || [])];
    newAliases[index] = value;
    setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  const removeAlias = (index: number) => {
    const newAliases = [...(editingAlias.aliases || [])];
    newAliases.splice(index, 1);
    setEditingAlias({ ...editingAlias, aliases: newAliases });
  };

  const codeClass = 'text-primary';

  return (
    <div className="border border-border-glass rounded-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-subtle hover:bg-bg-hover transition-colors duration-150 text-left"
      >
        <span className="font-body text-[13px] font-medium text-text-secondary">{t('sectionTitle')}</span>
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
              {t('behaviorsLabel')}
            </label>
            <div className="flex items-center justify-between py-1">
              <div>
                <span className="font-body text-[13px] text-text">{t('stripAdaptiveTitle')}</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
                  <Trans
                    i18nKey="models.behaviorsEditor.stripAdaptiveHelp"
                    components={{
                      1: <code className={codeClass} />,
                      2: <code className={codeClass} />,
                      3: <code className={codeClass} />,
                    }}
                  />
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
                <span className="font-body text-[13px] text-text">{t('visionFallthroughTitle')}</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
                  {t('visionFallthroughHelp')}
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
                <span className="font-body text-[13px] text-text">{t('enforceLimitsTitle')}</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
                  {t('enforceLimitsHelp')}
                </p>
                {editingAlias.enforce_limits &&
                  !editingAlias.metadata?.overrides?.context_length &&
                  !editingAlias.metadata?.overrides?.top_provider?.context_length && (
                    <p
                      className="font-body text-[11px] mt-1 flex items-center gap-1"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      <AlertTriangle size={12} />
                      {t('enforceLimitsWarning')}
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
                <span className="font-body text-[13px] text-text">{t('stickySessionTitle')}</span>
                <p className="font-body text-[11px] text-text-muted mt-0.5">
                  {t('stickySessionHelp')}
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

          {/* ── Additional Aliases ── */}
          <div>
            <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label
                className="font-body text-[13px] font-medium text-text-secondary"
                style={{ marginBottom: 0 }}
              >
                {t('additionalAliases')}
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={addAlias}
                leftIcon={<Plus size={14} />}
              >
                {t('addAlias')}
              </Button>
            </div>

            {(!editingAlias.aliases || editingAlias.aliases.length === 0) && (
              <div className="text-text-muted italic text-center text-sm py-2">{t('noAdditionalAliases')}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {editingAlias.aliases?.map((aliasRow, idx) => (
                <div key={idx} className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      value={aliasRow}
                      onChange={(e) => updateAlias(idx, e.target.value)}
                      placeholder={t('aliasPlaceholder')}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAlias(idx)}
                    style={{ color: 'var(--color-danger)' }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
