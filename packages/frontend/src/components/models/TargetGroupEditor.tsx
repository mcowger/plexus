import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AliasTargetGroup } from '../../lib/api';
import { dedupeModels, getModelOptionKey } from '../../lib/modelOptions';
import { Button } from '../ui/Button';
import { Switch } from '../ui/Switch';

interface TargetGroupEditorProps {
  groups: AliasTargetGroup[];
  providers: Array<{ id: string; name: string }>;
  availableModels: Array<{ id: string; providerId: string; name: string }>;
  availableAliases: string[];
  onChange: (groups: AliasTargetGroup[]) => void;
}

import { SELECTOR_LABELS } from '../../lib/selectors';

const SELECT_CLASS =
  'font-body text-text bg-bg-glass border-border-glass focus:border-primary min-w-0 rounded-sm border px-1.5 py-[3px] text-sm outline-none h-10 sm:h-[26px] sm:text-xs';
// 36px touch target on mobile; compact on sm+
const ICON_BTN_CLASS = 'min-h-9 min-w-9 p-2 sm:min-h-0 sm:min-w-0 sm:p-0.5';

const moveItem = <T,>(items: T[], from: number, to: number): T[] => {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export const TargetGroupEditor: React.FC<TargetGroupEditorProps> = ({
  groups,
  providers,
  availableModels,
  availableAliases,
  onChange,
}) => {
  const [dragState, setDragState] = useState<{
    mode: 'group' | 'target';
    groupIdx: number;
    targetIdx?: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState<{
    mode: 'group' | 'target';
    groupIdx: number;
    targetIdx?: number;
  } | null>(null);
  // Collapsed flags parallel to `groups`. Missing entries default to collapsed
  // only on mobile, and only for groups after the first. Desktop starts expanded.
  const [collapsedFlags, setCollapsedFlags] = useState<boolean[]>([]);
  const isSmUp = useMediaQuery('(min-width: 640px)');

  // A group with an incomplete target is never hidden, so it can't be saved unnoticed.
  const resolvedCollapsed = groups.map((group, i) =>
    group.targets.some((t) => (t.alias !== undefined ? !t.alias : !t.provider || !t.model))
      ? false
      : (collapsedFlags[i] ?? (!isSmUp && i > 0))
  );

  // Expand a group whose target count grows from outside (e.g. Auto Add).
  const prevTargetCounts = useRef(groups.map((g) => g.targets.length));
  useEffect(() => {
    const prev = prevTargetCounts.current;
    const grew = groups.map((g, i) => prev[i] !== undefined && g.targets.length > prev[i]);
    prevTargetCounts.current = groups.map((g) => g.targets.length);
    if (grew.some(Boolean)) {
      setCollapsedFlags((flags) => groups.map((_, i) => (grew[i] ? false : flags[i])) as boolean[]);
    }
  }, [groups]);

  const updateCollapsed = (updater: (flags: boolean[]) => boolean[]) => {
    setCollapsedFlags(updater(resolvedCollapsed));
  };

  const setGroups = (updater: (prev: AliasTargetGroup[]) => AliasTargetGroup[]) => {
    onChange(updater([...groups]));
  };

  const addGroup = () => {
    updateCollapsed((flags) => [...flags, false]);
    setGroups((prev) => [
      ...prev,
      { name: `Group ${prev.length + 1}`, selector: 'random', targets: [] },
    ]);
  };

  const removeGroup = (groupIdx: number) => {
    updateCollapsed((flags) => {
      const remaining = flags.filter((_, i) => i !== groupIdx);
      return remaining.length === 1 ? [false] : remaining;
    });
    setGroups((prev) => prev.filter((_, i) => i !== groupIdx));
  };

  const updateGroupField = <K extends keyof AliasTargetGroup>(
    groupIdx: number,
    field: K,
    value: AliasTargetGroup[K]
  ) => {
    setGroups((prev) => {
      const next = [...prev];
      next[groupIdx] = { ...next[groupIdx], [field]: value };
      return next;
    });
  };

  const addTarget = (groupIdx: number) => {
    setGroups((prev) => {
      const next = [...prev];
      next[groupIdx] = {
        ...next[groupIdx],
        targets: [...next[groupIdx].targets, { provider: '', model: '', enabled: true }],
      };
      return next;
    });
  };

  const removeTarget = (groupIdx: number, targetIdx: number) => {
    setGroups((prev) => {
      const next = [...prev];
      next[groupIdx] = {
        ...next[groupIdx],
        targets: next[groupIdx].targets.filter((_, i) => i !== targetIdx),
      };
      return next;
    });
  };

  const updateTarget = (
    groupIdx: number,
    targetIdx: number,
    field: 'provider' | 'model' | 'enabled',
    value: string | boolean
  ) => {
    setGroups((prev) => {
      const next = [...prev];
      const targets = [...next[groupIdx].targets];
      if (field === 'provider') {
        targets[targetIdx] = { provider: value as string, model: '', enabled: true };
      } else if (field === 'model') {
        targets[targetIdx] = { ...targets[targetIdx], model: value as string };
      } else {
        targets[targetIdx] = { ...targets[targetIdx], enabled: value as boolean };
      }
      next[groupIdx] = { ...next[groupIdx], targets };
      return next;
    });
  };

  const setTargetAlias = (groupIdx: number, targetIdx: number, alias: string) => {
    setGroups((prev) => {
      const next = [...prev];
      const targets = [...next[groupIdx].targets];
      targets[targetIdx] = { alias, enabled: true };
      next[groupIdx] = { ...next[groupIdx], targets };
      return next;
    });
  };

  const setTargetType = (groupIdx: number, targetIdx: number, type: 'model' | 'alias') => {
    setGroups((prev) => {
      const next = [...prev];
      const targets = [...next[groupIdx].targets];
      targets[targetIdx] =
        type === 'alias'
          ? { alias: availableAliases[0] ?? '', enabled: true }
          : { provider: '', model: '', enabled: true };
      next[groupIdx] = { ...next[groupIdx], targets };
      return next;
    });
  };

  const moveTarget = (groupIdx: number, targetIdx: number, direction: 'up' | 'down') => {
    setGroups((prev) => {
      const next = [...prev];
      const targets = [...next[groupIdx].targets];
      const newIdx = direction === 'up' ? targetIdx - 1 : targetIdx + 1;
      if (newIdx < 0 || newIdx >= targets.length) return prev;
      const [moved] = targets.splice(targetIdx, 1);
      targets.splice(newIdx, 0, moved);
      next[groupIdx] = { ...next[groupIdx], targets };
      return next;
    });
  };

  const moveGroup = (groupIdx: number, direction: 'up' | 'down') => {
    const newIdx = direction === 'up' ? groupIdx - 1 : groupIdx + 1;
    if (newIdx < 0 || newIdx >= groups.length) return;
    setGroups((prev) => moveItem(prev, groupIdx, newIdx));
    updateCollapsed((flags) => moveItem(flags, groupIdx, newIdx));
  };

  // Drag-and-drop handlers
  const handleDragStart = (
    e: React.DragEvent,
    mode: 'group' | 'target',
    groupIdx: number,
    targetIdx?: number
  ) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ mode, groupIdx, targetIdx }));
    setDragState({ mode, groupIdx, targetIdx });
  };

  const handleDragOver = (
    e: React.DragEvent,
    mode: 'group' | 'target',
    groupIdx: number,
    targetIdx?: number
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver({ mode, groupIdx, targetIdx });
  };

  const handleDrop = (
    e: React.DragEvent,
    destMode: 'group' | 'target',
    destGroupIdx: number,
    destTargetIdx?: number
  ) => {
    e.preventDefault();
    const src = JSON.parse(e.dataTransfer.getData('text/plain')) as {
      mode: 'group' | 'target';
      groupIdx: number;
      targetIdx?: number;
    };

    setDragState(null);
    setDragOver(null);

    // A group can only be dropped onto another group
    if (src.mode === 'group' && destMode !== 'group') return;

    if (src.mode === 'group') {
      if (src.groupIdx === destGroupIdx) return;
      setGroups((prev) => moveItem(prev, src.groupIdx, destGroupIdx));
      updateCollapsed((flags) => moveItem(flags, src.groupIdx, destGroupIdx));
      return;
    }

    setGroups((prev) => {
      const next = [...prev];

      // target mode
      if (src.groupIdx === destGroupIdx && src.targetIdx === destTargetIdx) return prev;
      const srcTargets = [...next[src.groupIdx].targets];
      const [moved] = srcTargets.splice(src.targetIdx!, 1);
      next[src.groupIdx] = { ...next[src.groupIdx], targets: srcTargets };

      const destTargets = [...next[destGroupIdx].targets];
      const insertAt = destTargetIdx !== undefined ? destTargetIdx : destTargets.length;
      destTargets.splice(insertAt, 0, moved);
      next[destGroupIdx] = { ...next[destGroupIdx], targets: destTargets };
      return next;
    });
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOver(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group, groupIdx) => {
        const isGroupDrag = dragState?.mode === 'group' && dragState.groupIdx === groupIdx;
        const isGroupDragOver = dragOver?.mode === 'group' && dragOver.groupIdx === groupIdx;
        const collapsed = resolvedCollapsed[groupIdx];
        const enabledCount = group.targets.filter((t) => t.enabled !== false).length;
        const summary = `${group.name || 'Untitled group'} · ${SELECTOR_LABELS[group.selector] ?? group.selector} · ${group.targets.length} ${group.targets.length === 1 ? 'target' : 'targets'} (${enabledCount} enabled)`;

        return (
          <div
            key={groupIdx}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, 'group', groupIdx)}
            onDragOver={(e) => handleDragOver(e, 'group', groupIdx)}
            onDrop={(e) => handleDrop(e, 'group', groupIdx)}
            onDragEnd={handleDragEnd}
            className="rounded border transition-all duration-200"
            style={{
              borderColor: isGroupDragOver ? 'var(--color-primary)' : 'var(--color-border-glass)',
              borderWidth: isGroupDragOver ? '2px' : '1px',
              backgroundColor: isGroupDrag ? 'transparent' : 'var(--color-bg-subtle)',
              opacity: isGroupDrag ? 0.5 : 1,
              cursor: 'grab',
            }}
          >
            {/* Group header */}
            <div
              className={`flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap ${collapsed ? '' : 'border-b'}`}
              style={{ borderColor: 'var(--color-border-glass)' }}
            >
              {/* Row 1 on mobile: toggle, name (or summary), delete. Flat on sm+. */}
              <div className="flex min-w-0 basis-full items-center gap-2 sm:contents">
                <button
                  type="button"
                  onClick={() =>
                    updateCollapsed((flags) => flags.map((v, i) => (i === groupIdx ? !v : v)))
                  }
                  aria-expanded={!collapsed}
                  title={collapsed ? 'Expand group' : 'Collapse group'}
                  className={`hover:text-primary text-text-secondary transition-colors ${ICON_BTN_CLASS}`}
                >
                  {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <div className="text-text-secondary hidden opacity-60 sm:block">
                  <GripVertical size={14} />
                </div>
                {collapsed ? (
                  <span
                    className="font-body text-text min-w-0 flex-1 truncate text-sm font-medium"
                    title={summary}
                  >
                    {summary}
                  </span>
                ) : (
                  <input
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary min-w-0 flex-1 rounded-sm border px-2 py-2 text-sm font-medium outline-none sm:py-1"
                    value={group.name}
                    onChange={(e) => updateGroupField(groupIdx, 'name', e.target.value)}
                    placeholder="Group name"
                  />
                )}
                {groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeGroup(groupIdx)}
                    className={`hover:text-danger text-text-secondary min-h-9 min-w-9 shrink-0 p-2 transition-colors sm:order-1 sm:min-h-0 sm:min-w-0 sm:p-1`}
                    title="Remove group"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Row 2 on mobile: strategy (expanded only), up/down. Flat on sm+. */}
              <div className="flex basis-full items-center justify-end gap-2 sm:contents">
                {!collapsed && (
                  <select
                    className="font-body text-text bg-bg-glass border-border-glass focus:border-primary mr-auto h-10 rounded-sm border px-2 py-1 text-sm outline-none sm:mr-0 sm:h-auto sm:text-xs"
                    value={group.selector}
                    onChange={(e) => updateGroupField(groupIdx, 'selector', e.target.value)}
                  >
                    {Object.entries(SELECTOR_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveGroup(groupIdx, 'up')}
                    disabled={groupIdx === 0}
                    className={`hover:text-primary disabled:hover:text-text-secondary transition-colors disabled:opacity-30 ${ICON_BTN_CLASS}`}
                    title="Move group up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveGroup(groupIdx, 'down')}
                    disabled={groupIdx === groups.length - 1}
                    className={`hover:text-primary disabled:hover:text-text-secondary transition-colors disabled:opacity-30 ${ICON_BTN_CLASS}`}
                    title="Move group down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Targets list */}
            {!collapsed && (
              <div className="flex flex-col gap-1 px-3 py-2">
                {group.targets.length === 0 && (
                  <div className="text-text-muted py-1 text-xs italic">
                    No targets in this group
                  </div>
                )}
                {group.targets.map((target, targetIdx) => {
                  const isTargetDrag =
                    dragState?.mode === 'target' &&
                    dragState.groupIdx === groupIdx &&
                    dragState.targetIdx === targetIdx;
                  const isTargetDragOver =
                    dragOver?.mode === 'target' &&
                    dragOver.groupIdx === groupIdx &&
                    dragOver.targetIdx === targetIdx;
                  const isAliasTarget = !!target.alias;
                  const modelOptions = isAliasTarget
                    ? []
                    : dedupeModels(
                        availableModels.filter((model) => model.providerId === target.provider)
                      ).filter(
                        (model) =>
                          model.id === target.model ||
                          !groups.some((candidateGroup, candidateGroupIdx) =>
                            candidateGroup.targets.some(
                              (candidateTarget, candidateTargetIdx) =>
                                (candidateGroupIdx !== groupIdx ||
                                  candidateTargetIdx !== targetIdx) &&
                                !candidateTarget.alias &&
                                getModelOptionKey(
                                  candidateTarget.provider,
                                  candidateTarget.model
                                ) === getModelOptionKey(model.providerId, model.id)
                            )
                          )
                      );
                  // A target can reference a model that is no longer (or never was)
                  // listed on its provider (e.g. pruned provider models, OpenRouter-style
                  // passthrough). Without a matching <option>, the <select> falls back
                  // to the "Model..." placeholder and the configured value looks lost.
                  // Keep the current value visible so it can be reviewed and saved.
                  if (
                    !isAliasTarget &&
                    target.model &&
                    !modelOptions.some((model) => model.id === target.model)
                  ) {
                    modelOptions.unshift({
                      id: target.model,
                      providerId: target.provider ?? '',
                      name: `${target.model} (not on provider)`,
                    });
                  }

                  return (
                    <div
                      key={targetIdx}
                      draggable={true}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        handleDragStart(e, 'target', groupIdx, targetIdx);
                      }}
                      onDragOver={(e) => {
                        e.stopPropagation();
                        handleDragOver(e, 'target', groupIdx, targetIdx);
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDrop(e, 'target', groupIdx, targetIdx);
                      }}
                      onDragEnd={handleDragEnd}
                      className="flex flex-wrap items-center gap-2 rounded px-2 py-2 transition-all duration-150 sm:flex-nowrap sm:py-1.5"
                      style={{
                        backgroundColor: isTargetDrag
                          ? 'transparent'
                          : isTargetDragOver
                            ? 'rgba(245, 158, 11, 0.05)'
                            : 'var(--color-bg-glass)',
                        border: isTargetDrag
                          ? '1px dashed var(--color-border-glass)'
                          : isTargetDragOver
                            ? '1px solid var(--color-primary)'
                            : '1px solid transparent',
                        opacity: isTargetDrag ? 0.5 : 1,
                        cursor: 'grab',
                      }}
                    >
                      <div className="text-text-secondary hidden opacity-50 sm:order-[-2] sm:block">
                        <GripVertical size={13} />
                      </div>

                      {/* Row 1 on mobile: position, type, spacer, up/down, switch, delete. Flat on sm+. */}
                      <div className="flex basis-full items-center gap-2 sm:contents">
                        <span className="text-text-muted w-4 text-xs tabular-nums sm:hidden">
                          {targetIdx + 1}
                        </span>
                        <select
                          className={SELECT_CLASS}
                          value={isAliasTarget ? 'alias' : 'model'}
                          onChange={(e) =>
                            setTargetType(groupIdx, targetIdx, e.target.value as 'model' | 'alias')
                          }
                        >
                          <option value="model">Model</option>
                          <option value="alias">Alias</option>
                        </select>
                        <div className="flex-1 sm:hidden" />
                        <div className="flex items-center gap-0.5 opacity-60 sm:order-[-1]">
                          <button
                            type="button"
                            onClick={() => moveTarget(groupIdx, targetIdx, 'up')}
                            disabled={targetIdx === 0}
                            className={`hover:text-primary transition-colors disabled:opacity-20 ${ICON_BTN_CLASS}`}
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTarget(groupIdx, targetIdx, 'down')}
                            disabled={targetIdx === group.targets.length - 1}
                            className={`hover:text-primary transition-colors disabled:opacity-20 ${ICON_BTN_CLASS}`}
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                        <div className="flex sm:order-1">
                          <Switch
                            checked={target.enabled !== false}
                            onChange={(val) => updateTarget(groupIdx, targetIdx, 'enabled', val)}
                            size="sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeTarget(groupIdx, targetIdx)}
                          className="hover:text-danger text-text-secondary min-h-9 min-w-9 p-2 transition-colors sm:order-1 sm:min-h-0 sm:min-w-0 sm:p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      {isAliasTarget ? (
                        <select
                          className={`${SELECT_CLASS} basis-full sm:flex-1`}
                          value={target.alias ?? ''}
                          onChange={(e) => setTargetAlias(groupIdx, targetIdx, e.target.value)}
                        >
                          <option value="">Alias...</option>
                          {availableAliases.map((aliasSlug) => (
                            <option key={aliasSlug} value={aliasSlug}>
                              {aliasSlug}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <div className="flex min-w-0 basis-full flex-col gap-1 sm:flex-1">
                            <span className="text-text-muted text-[11px] sm:hidden">Provider</span>
                            <select
                              className={`${SELECT_CLASS} w-full`}
                              value={target.provider ?? ''}
                              onChange={(e) =>
                                updateTarget(groupIdx, targetIdx, 'provider', e.target.value)
                              }
                            >
                              <option value="">Provider...</option>
                              {providers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex min-w-0 basis-full flex-col gap-1 sm:flex-[2]">
                            <span className="text-text-muted text-[11px] sm:hidden">Model</span>
                            <select
                              className={`${SELECT_CLASS} w-full`}
                              value={target.model ?? ''}
                              onChange={(e) =>
                                updateTarget(groupIdx, targetIdx, 'model', e.target.value)
                              }
                              disabled={!target.provider}
                            >
                              <option value="">Model...</option>
                              {modelOptions.map((model) => (
                                <option
                                  key={getModelOptionKey(model.providerId, model.id)}
                                  value={model.id}
                                >
                                  {model.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => addTarget(groupIdx)}
                  leftIcon={<Plus size={13} />}
                  className="text-text-secondary hover:text-text mt-1 justify-start text-xs"
                >
                  Add target
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <Button
        size="sm"
        variant="secondary"
        onClick={addGroup}
        leftIcon={<Plus size={14} />}
        className="self-start"
      >
        Add Target Group
      </Button>
    </div>
  );
};
