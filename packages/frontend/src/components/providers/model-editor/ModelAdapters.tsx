import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { ReasoningRewriteRulesEditor } from '../ReasoningRewriteRulesEditor';
import { ModelOverrideRules } from './ModelOverrideRules';
import { getAdapterName, KNOWN_ADAPTERS, normalizeAdapterEntries } from './adapter-utils';
import { GPT5_SUPPRESSION_ADAPTER, isGpt5Model } from './constants';
import type { ModelConfig } from './types';

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  updateModelConfig: (modelId: string, updates: any) => void;
}

export function ModelAdapters({
  modelId,
  modelConfig,
  isOpen,
  setIsOpen,
  updateModelConfig,
}: Props) {
  const modelAdapters = normalizeAdapterEntries(modelConfig.adapter);

  return (
    <div className="border border-border-glass rounded-md overflow-hidden">
      <div
        className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
          Model Adapters
        </span>
        {modelAdapters.length > 0 ? (
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            {modelAdapters.length}
          </Badge>
        ) : null}
      </div>
      {isOpen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px',
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            background: 'var(--color-bg-subtle)',
          }}
        >
          {isGpt5Model(modelId) && (
            <label
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border-glass)',
                background: modelAdapters.some(
                  (entry) =>
                    typeof entry !== 'string' &&
                    getAdapterName(entry) === GPT5_SUPPRESSION_ADAPTER &&
                    entry.enabled === false
                )
                  ? 'var(--color-bg-glass)'
                  : 'var(--color-bg-hover)',
              }}
            >
              <input
                type="checkbox"
                checked={
                  !modelAdapters.some(
                    (entry) =>
                      typeof entry !== 'string' &&
                      getAdapterName(entry) === GPT5_SUPPRESSION_ADAPTER &&
                      entry.enabled === false
                  )
                }
                style={{ marginTop: '2px', flexShrink: 0 }}
                onChange={() => {
                  const suppressionDisabled = modelAdapters.some(
                    (entry) =>
                      typeof entry !== 'string' &&
                      getAdapterName(entry) === GPT5_SUPPRESSION_ADAPTER &&
                      entry.enabled === false
                  );
                  const withoutSuppression = modelAdapters.filter(
                    (entry) => getAdapterName(entry) !== GPT5_SUPPRESSION_ADAPTER
                  );
                  const next = suppressionDisabled
                    ? withoutSuppression
                    : [
                        ...withoutSuppression,
                        {
                          name: GPT5_SUPPRESSION_ADAPTER,
                          options: {},
                          enabled: false,
                        },
                      ];
                  updateModelConfig(modelId, {
                    adapter: next.length > 0 ? next : undefined,
                  });
                }}
              />
              <div>
                <div className="font-body text-[12px] font-medium text-text">
                  Suppress Unsupported GPT-5 Options
                </div>
                <div
                  className="font-body text-[11px] text-text-secondary"
                  style={{ lineHeight: 1.35 }}
                >
                  Enabled by default. Removes generation options GPT-5 does not accept.
                </div>
              </div>
            </label>
          )}
          {KNOWN_ADAPTERS.map((adapter) => {
            const active = modelAdapters.some((entry) => getAdapterName(entry) === adapter.value);
            return (
              <label
                key={adapter.value}
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
                    const next = active
                      ? modelAdapters.filter((entry) => getAdapterName(entry) !== adapter.value)
                      : [
                          ...modelAdapters,
                          {
                            name: adapter.value,
                            options:
                              adapter.value === 'model_override' ||
                              adapter.value === 'reasoning_rewrite'
                                ? { rules: [] }
                                : {},
                          },
                        ];
                    updateModelConfig(modelId, {
                      adapter: next.length > 0 ? next : undefined,
                    });
                  }}
                />
                <div>
                  <div className="font-body text-[12px] font-medium text-text">{adapter.label}</div>
                  <div
                    className="font-body text-[11px] text-text-secondary"
                    style={{ lineHeight: 1.35 }}
                  >
                    {adapter.description}
                  </div>
                </div>
              </label>
            );
          })}
          <ModelOverrideRules
            modelId={modelId}
            modelConfig={modelConfig}
            updateModelConfig={updateModelConfig}
          />
          <ReasoningRewriteRulesEditor
            adapters={modelAdapters}
            onChange={(next: any[]) => updateModelConfig(modelId, { adapter: next })}
          />
        </div>
      )}
    </div>
  );
}
