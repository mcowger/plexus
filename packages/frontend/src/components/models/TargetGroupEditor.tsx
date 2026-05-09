import React, { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { AliasTargetGroup } from '../../lib/api';

interface TargetGroupEditorProps {
  groups: AliasTargetGroup[];
  providers: Array<{ id: string; name: string }>;
  availableModels: Array<{ id: string; providerId: string; name: string }>;
  onChange: (groups: AliasTargetGroup[]) => void;
}

const SELECTOR_LABELS: Record<string, string> = {
  random: 'Random',
  in_order: 'In Order',
  cost: 'Lowest Cost',
  latency: 'Lowest Latency',
  usage: 'Usage Balanced',
  performance: 'Best Performance (post-TTFT)',
  e2e_performance: 'Best E2E Performance',
};

export const TargetGroupEditor: React.FC<TargetGroupEditorProps> = ({
  groups,
  providers,
  availableModels,
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

  const setGroups = (updater: (prev: AliasTargetGroup[]) => AliasTargetGroup[]) => {
    onChange(updater([...groups]));
  };

  const addGroup = () => {
    setGroups((prev) => [
      ...prev,
      { name: `Group ${prev.length + 1}`, selector: 'random', targets: [] },
    ]);
  };

  const removeGroup = (groupIdx: number) => {
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
    setGroups((prev) => {
      const next = [...prev];
      const newIdx = direction === 'up' ? groupIdx - 1 : groupIdx + 1;
      if (newIdx < 0 || newIdx >= next.length) return prev;
      const [moved] = next.splice(groupIdx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
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

    setGroups((prev) => {
      const next = [...prev];

      if (src.mode === 'group') {
        if (src.groupIdx === destGroupIdx) return prev;
        const [moved] = next.splice(src.groupIdx, 1);
        next.splice(destGroupIdx, 0, moved);
        return next;
      }

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
              className="flex items-center gap-2 px-3 py-2 border-b"
              style={{ borderColor: 'var(--color-border-glass)' }}
            >
              <div className="text-text-secondary opacity-60">
                <GripVertical size={14} />
              </div>
              <input
                className="flex-1 min-w-0 py-1 px-2 font-body text-sm font-medium text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                value={group.name}
                onChange={(e) => updateGroupField(groupIdx, 'name', e.target.value)}
                placeholder="Group name"
              />
              <select
                className="py-1 px-2 font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                value={group.selector}
                onChange={(e) => updateGroupField(groupIdx, 'selector', e.target.value)}
              >
                {Object.entries(SELECTOR_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => moveGroup(groupIdx, 'up')}
                  disabled={groupIdx === 0}
                  className="hover:text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors p-1"
                  title="Move group up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => moveGroup(groupIdx, 'down')}
                  disabled={groupIdx === groups.length - 1}
                  className="hover:text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors p-1"
                  title="Move group down"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              {groups.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeGroup(groupIdx)}
                  className="hover:text-danger text-text-secondary transition-colors p-1"
                  title="Remove group"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {/* Targets list */}
            <div className="px-3 py-2 flex flex-col gap-1">
              {group.targets.length === 0 && (
                <div className="text-text-muted italic text-xs py-1">No targets in this group</div>
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
                    className="flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150"
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
                    <div className="text-text-secondary opacity-50">
                      <GripVertical size={13} />
                    </div>
                    <div className="flex items-center gap-0.5 opacity-60">
                      <button
                        type="button"
                        onClick={() => moveTarget(groupIdx, targetIdx, 'up')}
                        disabled={targetIdx === 0}
                        className="hover:text-primary disabled:opacity-20 transition-colors p-0.5"
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTarget(groupIdx, targetIdx, 'down')}
                        disabled={targetIdx === group.targets.length - 1}
                        className="hover:text-primary disabled:opacity-20 transition-colors p-0.5"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <select
                      className="flex-1 min-w-0 font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                      style={{ padding: '3px 6px', height: '26px' }}
                      value={target.provider}
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
                    <select
                      className="flex-[2] min-w-0 font-body text-xs text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                      style={{ padding: '3px 6px', height: '26px' }}
                      value={target.model}
                      onChange={(e) => updateTarget(groupIdx, targetIdx, 'model', e.target.value)}
                      disabled={!target.provider}
                    >
                      <option value="">Model...</option>
                      {availableModels
                        .filter((m) => m.providerId === target.provider)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                    <Switch
                      checked={target.enabled !== false}
                      onChange={(val) => updateTarget(groupIdx, targetIdx, 'enabled', val)}
                      size="sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeTarget(groupIdx, targetIdx)}
                      className="hover:text-danger text-text-secondary transition-colors p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}

              <Button
                size="sm"
                variant="ghost"
                onClick={() => addTarget(groupIdx)}
                leftIcon={<Plus size={13} />}
                className="mt-1 justify-start text-xs text-text-secondary hover:text-text"
              >
                Add target
              </Button>
            </div>
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
