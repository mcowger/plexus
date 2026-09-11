import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { DebouncedInput } from '../../ui/DebouncedInput';
import { getAdapterName, normalizeAdapterEntries } from './adapter-utils';
import type { ModelConfig } from './types';

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  updateModelConfig: (modelId: string, updates: any) => void;
}

export function ModelOverrideRules({ modelId, modelConfig, updateModelConfig }: Props) {
  const modelAdapters = normalizeAdapterEntries(modelConfig.adapter);
  const overrideEntry = modelAdapters.find((entry) => getAdapterName(entry) === 'model_override');
  if (!overrideEntry || typeof overrideEntry === 'string') return null;

  const rules: any[] = overrideEntry.options?.rules ?? [];
  const applyRules = (updated: any[]) => {
    const newAdapters = modelAdapters.map((entry) =>
      typeof entry !== 'string' && getAdapterName(entry) === 'model_override'
        ? { ...entry, options: { ...entry.options, rules: updated } }
        : entry
    );
    updateModelConfig(modelId, { adapter: newAdapters });
  };

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        borderTop: '1px solid var(--color-border-glass)',
        marginTop: '4px',
        paddingTop: '6px',
      }}
    >
      <div className="font-body text-[11px] font-medium text-text-secondary mb-1">
        Model Override Rules
      </div>
      <div className="font-body text-[10px] text-text-muted mb-2" style={{ lineHeight: 1.3 }}>
        When ANY condition matches, rewrite the model name. Use dotted paths like reasoning.enabled.
      </div>
      {rules.map((rule: any, rIdx: number) => (
        <div
          key={rIdx}
          style={{
            border: '1px solid var(--color-border-glass)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px',
            marginBottom: '4px',
            background: 'var(--color-bg-subtle)',
          }}
        >
          <div className="font-body text-[10px] font-medium text-text-muted mb-1">Rewrite</div>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <div
              className="font-body text-[12px] text-text-muted"
              style={{
                flex: 2,
                padding: '5px 8px',
                background: 'var(--color-bg-glass)',
                border: '1px solid var(--color-border-glass)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={modelId}
            >
              {modelId}
            </div>
            <span className="font-body text-[11px] text-text-muted">→</span>
            <div style={{ flex: 1 }}>
              <DebouncedInput
                placeholder="Rewrite to (e.g. deepseek-r1-fast)"
                value={rule.rewriteTo ?? ''}
                onChange={(val: string) => {
                  const updated = [...rules];
                  updated[rIdx] = { ...updated[rIdx], rewriteTo: val };
                  applyRules(updated);
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyRules(rules.filter((_rule: any, i: number) => i !== rIdx))}
              style={{ padding: '4px' }}
            >
              <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
            </Button>
          </div>
          <div
            style={{ borderTop: '1px solid var(--color-border-glass)', margin: '6px 0 4px 0' }}
          />
          <div className="font-body text-[10px] font-medium text-text-muted mb-1">
            Conditions (any match triggers rewrite)
          </div>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '2px', marginLeft: '8px' }}>
            <span
              className="font-body text-[9px] font-medium text-text-muted"
              style={{ flex: 1, paddingLeft: '8px' }}
            >
              Field path (dotted)
            </span>
            <span
              className="font-body text-[9px] font-medium text-text-muted"
              style={{ flex: 1, paddingLeft: '8px' }}
            >
              Value (blank = presence check)
            </span>
            <span style={{ width: '28px' }} />
          </div>
          {(rule.conditions ?? []).map((cond: any, cIdx: number) => (
            <div
              key={cIdx}
              style={{ display: 'flex', gap: '4px', marginBottom: '2px', marginLeft: '8px' }}
            >
              <div style={{ flex: 2 }}>
                <DebouncedInput
                  placeholder="e.g. reasoning.enabled"
                  value={cond.field ?? ''}
                  onChange={(val: string) => {
                    const updated = [...rules];
                    const newConditions = [...updated[rIdx].conditions];
                    newConditions[cIdx] = { ...newConditions[cIdx], field: val };
                    updated[rIdx] = { ...updated[rIdx], conditions: newConditions };
                    applyRules(updated);
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <DebouncedInput
                  placeholder="e.g. false, 0, none"
                  value={cond.value !== undefined ? String(cond.value) : ''}
                  onChange={(val: string) => {
                    const parsed =
                      val === ''
                        ? undefined
                        : val === 'true'
                          ? true
                          : val === 'false'
                            ? false
                            : isNaN(Number(val))
                              ? val
                              : Number(val);
                    const updated = [...rules];
                    const newConditions = [...updated[rIdx].conditions];
                    newConditions[cIdx] = { field: newConditions[cIdx].field, value: parsed };
                    updated[rIdx] = { ...updated[rIdx], conditions: newConditions };
                    applyRules(updated);
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const updated = [...rules];
                  const newConditions = updated[rIdx].conditions.filter(
                    (_condition: any, i: number) => i !== cIdx
                  );
                  updated[rIdx] = { ...updated[rIdx], conditions: newConditions };
                  applyRules(updated);
                }}
                style={{ padding: '4px' }}
              >
                <Trash2 size={12} style={{ color: 'var(--color-danger)' }} />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const updated = [...rules];
              updated[rIdx] = {
                ...updated[rIdx],
                conditions: [...(updated[rIdx].conditions ?? []), { field: '' }],
              };
              applyRules(updated);
            }}
            style={{ marginLeft: '8px', padding: '2px 6px' }}
          >
            <Plus size={12} /> <span className="font-body text-[10px]">Condition</span>
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          applyRules([...rules, { model: modelId, rewriteTo: '', conditions: [{ field: '' }] }])
        }
        style={{ marginTop: '2px' }}
      >
        <Plus size={12} /> <span className="font-body text-[10px]">Rule</span>
      </Button>
    </div>
  );
}
