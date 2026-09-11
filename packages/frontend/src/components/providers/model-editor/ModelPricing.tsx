import { Plus, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { OpenRouterSlugInput } from '../../ui/OpenRouterSlugInput';
import { FIELD_CLS } from './constants';
import type { ModelConfig } from './types';

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  updateModelConfig: (modelId: string, updates: any) => void;
}

export function ModelPricing({ modelId, modelConfig, updateModelConfig }: Props) {
  const mCfg = modelConfig;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div className="flex flex-col gap-1">
        <label className="font-body text-[11px] font-medium text-text-secondary">
          Pricing Source
        </label>
        <select
          className={FIELD_CLS}
          value={mCfg.pricing?.source || 'simple'}
          onChange={(e) => {
            const newSource = e.target.value;
            let newPricing: any;
            if (newSource === 'simple')
              newPricing = {
                source: 'simple',
                input: mCfg.pricing?.input || 0,
                output: mCfg.pricing?.output || 0,
                cached: mCfg.pricing?.cached || 0,
                cache_write: mCfg.pricing?.cache_write || 0,
              };
            else if (newSource === 'openrouter')
              newPricing = {
                source: 'openrouter',
                slug: mCfg.pricing?.slug || '',
                ...(mCfg.pricing?.discount !== undefined && {
                  discount: mCfg.pricing.discount,
                }),
              };
            else if (newSource === 'defined')
              newPricing = {
                source: 'defined',
                range: mCfg.pricing?.range || [],
              };
            else if (newSource === 'per_request')
              newPricing = {
                source: 'per_request',
                amount: mCfg.pricing?.amount || 0,
              };
            updateModelConfig(modelId, { pricing: newPricing });
          }}
        >
          <option value="simple">Simple</option>
          <option value="openrouter">OpenRouter</option>
          <option value="defined">Ranges (Complex)</option>
          <option value="per_request">Per Request (Flat Fee)</option>
        </select>
      </div>

      {mCfg.pricing?.source === 'simple' && (
        <div
          className="grid grid-cols-2"
          style={{
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-sm)',
            gap: '6px',
          }}
        >
          {[
            { label: 'Input $/M', key: 'input' },
            { label: 'Output $/M', key: 'output' },
            { label: 'Cached $/M', key: 'cached' },
            { label: 'Cache Write $/M', key: 'cache_write' },
          ].map(({ label, key }) => (
            <div key={key} className="flex flex-col gap-0.5">
              <label className="font-body text-[11px] font-medium text-text-secondary">
                {label}
              </label>
              <input
                className={FIELD_CLS}
                type="number"
                step="0.000001"
                value={(mCfg.pricing as any)[key] || 0}
                onChange={(e) =>
                  updateModelConfig(modelId, {
                    pricing: {
                      ...mCfg.pricing,
                      [key]: parseFloat(e.target.value),
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      )}

      {mCfg.pricing?.source === 'openrouter' && (
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div className="flex flex-col gap-0.5">
            <label className="font-body text-[11px] font-medium text-text-secondary">
              OpenRouter Model Slug
            </label>
            <OpenRouterSlugInput
              placeholder="e.g. anthropic/claude-3.5-sonnet"
              value={mCfg.pricing.slug || ''}
              onChange={(value) =>
                updateModelConfig(modelId, {
                  pricing: { ...mCfg.pricing, slug: value },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-body text-[11px] font-medium text-text-secondary">
              Discount <span className="font-normal text-text-muted">(0.1 = 10% off)</span>
            </label>
            <input
              className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={mCfg.pricing.discount ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  const { discount, ...rest } = mCfg.pricing;
                  updateModelConfig(modelId, { pricing: rest });
                } else
                  updateModelConfig(modelId, {
                    pricing: { ...mCfg.pricing, discount: parseFloat(val) },
                  });
              }}
            />
          </div>
        </div>
      )}

      {mCfg.pricing?.source === 'defined' && (
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="font-body text-[11px] font-medium text-text-secondary">
              Pricing Ranges
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const currentRanges = mCfg.pricing.range || [];
                updateModelConfig(modelId, {
                  pricing: {
                    ...mCfg.pricing,
                    range: [
                      ...currentRanges,
                      {
                        lower_bound: 0,
                        upper_bound: 0,
                        input_per_m: 0,
                        output_per_m: 0,
                        cache_write_per_m: 0,
                      },
                    ],
                  },
                });
              }}
              leftIcon={<Plus size={14} />}
            >
              Add Range
            </Button>
          </div>
          {(mCfg.pricing.range || []).map((range: any, idx: number) => (
            <div
              key={idx}
              style={{
                border: '1px solid var(--color-border-glass)',
                padding: '8px',
                borderRadius: 'var(--radius-sm)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <Button
                size="sm"
                variant="ghost"
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  color: 'var(--color-danger)',
                  padding: '4px',
                }}
                onClick={() => {
                  const r = [...mCfg.pricing.range];
                  r.splice(idx, 1);
                  updateModelConfig(modelId, {
                    pricing: { ...mCfg.pricing, range: r },
                  });
                }}
              >
                <X size={14} />
              </Button>
              <div className="grid grid-cols-2" style={{ gap: '6px' }}>
                {[
                  {
                    label: 'Lower Bound',
                    field: 'lower_bound',
                    val: range.lower_bound,
                  },
                  {
                    label: 'Upper Bound (0=∞)',
                    field: 'upper_bound',
                    val: range.upper_bound === Infinity ? 0 : range.upper_bound,
                  },
                  {
                    label: 'Input $/M',
                    field: 'input_per_m',
                    val: range.input_per_m,
                  },
                  {
                    label: 'Output $/M',
                    field: 'output_per_m',
                    val: range.output_per_m,
                  },
                  {
                    label: 'Cached $/M',
                    field: 'cached_per_m',
                    val: range.cached_per_m || 0,
                  },
                  {
                    label: 'Cache Write $/M',
                    field: 'cache_write_per_m',
                    val: range.cache_write_per_m || 0,
                  },
                ].map(({ label, field, val }) => (
                  <div key={field} className="flex flex-col gap-0.5">
                    <label className="font-body text-[10px] font-medium text-text-secondary">
                      {label}
                    </label>
                    <input
                      className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
                      type="number"
                      step="0.000001"
                      value={val}
                      onChange={(e) => {
                        const r = [...mCfg.pricing.range];
                        const v =
                          field === 'upper_bound'
                            ? parseFloat(e.target.value) === 0
                              ? Infinity
                              : parseFloat(e.target.value)
                            : parseFloat(e.target.value);
                        r[idx] = {
                          ...range,
                          [field]: Number.isFinite(v) ? v : field === 'upper_bound' ? Infinity : 0,
                        };
                        updateModelConfig(modelId, {
                          pricing: { ...mCfg.pricing, range: r },
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(!mCfg.pricing.range || mCfg.pricing.range.length === 0) && (
            <div className="text-text-muted italic text-center text-[11px] py-2">
              No ranges defined.
            </div>
          )}
        </div>
      )}

      {mCfg.pricing?.source === 'per_request' && (
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            padding: '8px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div className="flex flex-col gap-0.5">
            <label className="font-body text-[11px] font-medium text-text-secondary">
              Cost Per Request ($)
            </label>
            <input
              className="w-full py-1 px-2 font-body text-[12px] leading-none text-text bg-bg-glass border border-border-glass rounded-sm outline-none focus:border-primary"
              type="number"
              step="0.000001"
              min="0"
              value={mCfg.pricing.amount || 0}
              onChange={(e) =>
                updateModelConfig(modelId, {
                  pricing: {
                    ...mCfg.pricing,
                    amount: parseFloat(e.target.value) || 0,
                  },
                })
              }
            />
          </div>
          <span className="font-body text-[11px] text-text-muted italic">
            Flat fee per API call, regardless of token count.
          </span>
        </div>
      )}
    </div>
  );
}
