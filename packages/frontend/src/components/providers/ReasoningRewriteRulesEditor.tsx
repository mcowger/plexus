import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { DebouncedInput } from '../ui/DebouncedInput';
import { getAdapterName, normalizeAdapterEntries } from './model-editor/adapter-utils';

interface Props {
  /** Current adapter entries for the scope (provider-level or model-level). */
  adapters: unknown;
  /** Called with the new adapter entry array whenever a rule changes. */
  onChange: (adapters: any[]) => void;
}

/**
 * Shared editor for the `reasoning_rewrite` adapter's rules, used at both the
 * provider level (ProviderAdvancedEditor) and the per-model level
 * (ProviderModelsEditor). Renders nothing when the adapter entry is missing
 * or stored in the legacy string form.
 *
 * Each rule reads a source dotted path, optionally gated by a `when`
 * condition, writes one or more rewrite targets, and can strip leftover
 * paths afterward (see backend reasoning-rewrite.adapter.ts for semantics).
 */
export function ReasoningRewriteRulesEditor({ adapters, onChange }: Props) {
  const adapterEntries = normalizeAdapterEntries(adapters);
  const entry = adapterEntries.find((e: any) => getAdapterName(e) === 'reasoning_rewrite');
  if (!entry || typeof entry === 'string') return null;
  const rules: any[] = entry.options?.rules ?? [];

  const applyRules = (updated: any[]) => {
    onChange(
      adapterEntries.map((e: any) =>
        typeof e !== 'string' && getAdapterName(e) === 'reasoning_rewrite'
          ? { ...e, options: { ...e.options, rules: updated } }
          : e
      )
    );
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
        Reasoning Rewrite Rules
      </div>
      <div className="font-body text-[10px] text-text-muted mb-2" style={{ lineHeight: 1.3 }}>
        Map unified reasoning fields to provider-specific formats. Each rule reads a source field
        and writes one or more targets.
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
          {/* Source + When condition */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              alignItems: 'center',
              marginBottom: '4px',
            }}
          >
            <div style={{ flex: 2 }}>
              <DebouncedInput
                placeholder="Source (e.g. reasoning.enabled)"
                value={rule.source ?? ''}
                onChange={(val: string) => {
                  const updated = [...rules];
                  updated[rIdx] = {
                    ...updated[rIdx],
                    source: val,
                  };
                  applyRules(updated);
                }}
              />
            </div>
            {/* When operator */}
            <div style={{ flex: 0.7 }}>
              <select
                className="w-full py-1 pl-2 pr-2 font-body text-[11px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                value={rule.when?.op ?? ''}
                onChange={(e) => {
                  const op = e.target.value;
                  const updated = [...rules];
                  updated[rIdx] = {
                    ...updated[rIdx],
                    when: op ? { op } : undefined,
                  };
                  applyRules(updated);
                }}
              >
                <option value="">Any (present)</option>
                <option value="eq">Equals</option>
                <option value="neq">Not equals</option>
                <option value="gt">Greater than</option>
                <option value="gte">≥</option>
                <option value="lt">Less than</option>
                <option value="lte">≤</option>
                <option value="in">In list</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            {/* When value */}
            <div style={{ flex: 1 }}>
              <DebouncedInput
                placeholder="Value"
                value={
                  rule.when?.value != null
                    ? String(rule.when.value)
                    : rule.when?.values
                      ? rule.when.values.join(',')
                      : ''
                }
                onChange={(val: string) => {
                  const updated = [...rules];
                  const currentWhen = updated[rIdx].when || {};
                  if (currentWhen.op === 'in') {
                    updated[rIdx] = {
                      ...updated[rIdx],
                      when: {
                        ...currentWhen,
                        values: val
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean),
                      },
                    };
                  } else {
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
                    updated[rIdx] = {
                      ...updated[rIdx],
                      when: { ...currentWhen, value: parsed },
                    };
                  }
                  applyRules(updated);
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const updated = rules.filter((_: any, i: number) => i !== rIdx);
                applyRules(updated);
              }}
              style={{ padding: '4px' }}
            >
              <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
            </Button>
          </div>
          {/* Rewrites */}
          <div className="font-body text-[10px] font-medium text-text-muted mb-1">Rewrites</div>
          {(rule.rewrites ?? []).map((rw: any, rwIdx: number) => (
            <div
              key={rwIdx}
              style={{
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                marginBottom: '2px',
                marginLeft: '8px',
              }}
            >
              <div style={{ flex: 2 }}>
                <DebouncedInput
                  placeholder="Target path (e.g. enable_thinking)"
                  value={rw.target ?? ''}
                  onChange={(val: string) => {
                    const updated = [...rules];
                    const newRewrites = [...updated[rIdx].rewrites];
                    newRewrites[rwIdx] = {
                      ...newRewrites[rwIdx],
                      target: val,
                    };
                    updated[rIdx] = {
                      ...updated[rIdx],
                      rewrites: newRewrites,
                    };
                    applyRules(updated);
                  }}
                />
              </div>
              {/* Value type selector */}
              <div style={{ flex: 0.7 }}>
                <select
                  className="w-full py-1 pl-2 pr-2 font-body text-[11px] text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                  value={
                    rw.value === null
                      ? 'null'
                      : rw.value === undefined
                        ? ''
                        : typeof rw.value !== 'object'
                          ? 'literal'
                          : rw.value.from === 'source'
                            ? 'source'
                            : rw.value.from === 'map'
                              ? 'map'
                              : rw.value.from === 'boolean'
                                ? 'boolean'
                                : 'literal'
                  }
                  onChange={(e) => {
                    const valType = e.target.value;
                    let newValue: any;
                    switch (valType) {
                      case 'source':
                        newValue = { from: 'source' };
                        break;
                      case 'map':
                        newValue = { from: 'map', values: {} };
                        break;
                      case 'boolean':
                        newValue = {
                          from: 'boolean',
                          truthy: 'enabled',
                          falsy: 'disabled',
                        };
                        break;
                      case 'null':
                        newValue = null;
                        break;
                      default:
                        newValue = '';
                        break;
                    }
                    const updated = [...rules];
                    const newRewrites = [...updated[rIdx].rewrites];
                    newRewrites[rwIdx] = {
                      ...newRewrites[rwIdx],
                      value: newValue,
                    };
                    updated[rIdx] = {
                      ...updated[rIdx],
                      rewrites: newRewrites,
                    };
                    applyRules(updated);
                  }}
                >
                  <option value="literal">Literal</option>
                  <option value="source">From source</option>
                  <option value="map">Value map</option>
                  <option value="boolean">Bool map</option>
                  <option value="null">null</option>
                </select>
              </div>
              {/* Value input — changes meaning based on type */}
              <div style={{ flex: 1 }}>
                {(() => {
                  if (rw.value === null)
                    return (
                      <span className="font-body text-[11px] text-text-muted italic">null</span>
                    );
                  if (rw.value?.from === 'source')
                    return (
                      <span className="font-body text-[11px] text-text-muted italic">
                        passthrough
                      </span>
                    );
                  if (rw.value?.from === 'map') {
                    const mapStr = Object.entries(rw.value.values || {})
                      .map(([k, v]) => `${k}:${v}`)
                      .join(', ');
                    return (
                      <DebouncedInput
                        placeholder="key:value, key:value"
                        value={mapStr}
                        onChange={(val: string) => {
                          const values: Record<string, any> = {};
                          val.split(',').forEach((pair: string) => {
                            const [k, ...rest] = pair.split(':');
                            const v = rest.join(':').trim();
                            if (k?.trim()) {
                              const numV = Number(v);
                              values[k.trim()] = v === '' ? '' : isNaN(Number(v)) ? v : numV;
                            }
                          });
                          const updated = [...rules];
                          const newRewrites = [...updated[rIdx].rewrites];
                          newRewrites[rwIdx] = {
                            ...newRewrites[rwIdx],
                            value: { from: 'map', values },
                          };
                          updated[rIdx] = {
                            ...updated[rIdx],
                            rewrites: newRewrites,
                          };
                          applyRules(updated);
                        }}
                      />
                    );
                  }
                  if (rw.value?.from === 'boolean') {
                    return (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <DebouncedInput
                          placeholder="If true"
                          value={String(rw.value.truthy ?? '')}
                          onChange={(val: string) => {
                            const updated = [...rules];
                            const newRewrites = [...updated[rIdx].rewrites];
                            newRewrites[rwIdx] = {
                              ...newRewrites[rwIdx],
                              value: {
                                ...newRewrites[rwIdx].value,
                                truthy: val,
                              },
                            };
                            updated[rIdx] = {
                              ...updated[rIdx],
                              rewrites: newRewrites,
                            };
                            applyRules(updated);
                          }}
                        />
                        <DebouncedInput
                          placeholder="If false"
                          value={String(rw.value.falsy ?? '')}
                          onChange={(val: string) => {
                            const updated = [...rules];
                            const newRewrites = [...updated[rIdx].rewrites];
                            newRewrites[rwIdx] = {
                              ...newRewrites[rwIdx],
                              value: {
                                ...newRewrites[rwIdx].value,
                                falsy: val,
                              },
                            };
                            updated[rIdx] = {
                              ...updated[rIdx],
                              rewrites: newRewrites,
                            };
                            applyRules(updated);
                          }}
                        />
                      </div>
                    );
                  }
                  // Literal value
                  return (
                    <DebouncedInput
                      placeholder="Literal value"
                      value={String(rw.value ?? '')}
                      onChange={(val: string) => {
                        const parsed =
                          val === 'true'
                            ? true
                            : val === 'false'
                              ? false
                              : isNaN(Number(val))
                                ? val
                                : Number(val);
                        const updated = [...rules];
                        const newRewrites = [...updated[rIdx].rewrites];
                        newRewrites[rwIdx] = {
                          ...newRewrites[rwIdx],
                          value: parsed,
                        };
                        updated[rIdx] = {
                          ...updated[rIdx],
                          rewrites: newRewrites,
                        };
                        applyRules(updated);
                      }}
                    />
                  );
                })()}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const updated = [...rules];
                  const newRewrites = updated[rIdx].rewrites.filter(
                    (_: any, i: number) => i !== rwIdx
                  );
                  updated[rIdx] = {
                    ...updated[rIdx],
                    rewrites: newRewrites,
                  };
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
                rewrites: [...(updated[rIdx].rewrites ?? []), { target: '', value: '' }],
              };
              applyRules(updated);
            }}
            style={{ marginLeft: '8px', padding: '2px 6px' }}
          >
            <Plus size={12} /> <span className="font-body text-[10px]">Rewrite</span>
          </Button>
          {/* Strip paths */}
          <div
            style={{
              borderTop: '1px solid var(--color-border-glass)',
              margin: '6px 0 4px 0',
            }}
          />
          <div className="font-body text-[10px] font-medium text-text-muted mb-1">
            Strip paths (remove from payload after rewrite)
          </div>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              marginLeft: '8px',
              flexWrap: 'wrap',
            }}
          >
            {(rule.strip ?? []).map((stripPath: string, sIdx: number) => (
              <div key={sIdx} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                <div
                  className="font-body text-[11px] text-text"
                  style={{
                    padding: '2px 8px',
                    background: 'var(--color-bg-glass)',
                    border: '1px solid var(--color-border-glass)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  {stripPath}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const updated = [...rules];
                    const newStrip = updated[rIdx].strip.filter((_: any, i: number) => i !== sIdx);
                    updated[rIdx] = {
                      ...updated[rIdx],
                      strip: newStrip.length > 0 ? newStrip : undefined,
                    };
                    applyRules(updated);
                  }}
                  style={{ padding: '2px' }}
                >
                  <Trash2 size={10} style={{ color: 'var(--color-danger)' }} />
                </Button>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              marginLeft: '8px',
              marginTop: '2px',
            }}
          >
            <Input
              placeholder="Path to strip (e.g. reasoning) — press Enter"
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') {
                  const draft = (e.target as HTMLInputElement).value.trim();
                  if (draft) {
                    const updated = [...rules];
                    updated[rIdx] = {
                      ...updated[rIdx],
                      strip: [...(updated[rIdx].strip ?? []), draft],
                    };
                    applyRules(updated);
                    (e.target as HTMLInputElement).value = '';
                  }
                }
              }}
              style={{ flex: 1, fontSize: '11px' }}
            />
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const newRule = {
            source: '',
            rewrites: [{ target: '', value: '' }],
          };
          applyRules([...rules, newRule]);
        }}
        style={{ marginTop: '2px' }}
      >
        <Plus size={12} /> <span className="font-body text-[10px]">Rule</span>
      </Button>
    </div>
  );
}
