import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '../../ui/Badge';
import { FIELD_CLS } from './constants';
import type { ModelConfig } from './types';

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  updateModelConfig: (modelId: string, updates: any) => void;
  piAiProvider?: string;
  inlineQuirksAvailable: boolean;
}

export function ModelAdvanced({
  modelId,
  modelConfig,
  isOpen,
  setIsOpen,
  updateModelConfig,
  piAiProvider,
  inlineQuirksAvailable,
}: Props) {
  const mappingReady = !!piAiProvider || inlineQuirksAvailable;
  return (
    <div className="border-border-glass overflow-hidden rounded-md border">
      <div
        className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center gap-2 p-2 px-3"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-body text-text-secondary flex-1 text-[12px] font-medium">
          Advanced
        </span>
        {modelConfig.maxConcurrency != null && (
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            Concurrency: {modelConfig.maxConcurrency}
          </Badge>
        )}
        {modelConfig.auto_compat === true && (
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            Auto Compat
          </Badge>
        )}
      </div>
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            background: 'var(--color-bg-subtle)',
          }}
        >
          <div className="flex flex-col gap-0.5">
            <label
              className="flex cursor-pointer items-start gap-2 py-1"
              title={
                !mappingReady && modelConfig.auto_compat !== true
                  ? 'Select a pi-ai provider or inline quirks first'
                  : undefined
              }
            >
              <input
                type="checkbox"
                disabled={!mappingReady && modelConfig.auto_compat !== true}
                checked={modelConfig.auto_compat === true}
                onChange={(e) =>
                  updateModelConfig(modelId, {
                    auto_compat: e.target.checked ? true : undefined,
                  })
                }
              />
              <div>
                <div className="font-body text-text text-[12px]">Auto Compat</div>
                <div className="font-body text-text-muted text-[11px]" style={{ lineHeight: 1.35 }}>
                  Translates this model's reasoning and generation options using its mapped pi-ai
                  model or the provider's inline quirks. Requires Auto Compat here or on the
                  provider.
                </div>
              </div>
            </label>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-body text-text-secondary text-[11px] font-medium">
              Max Concurrency
              <span className="text-text-muted ml-1 text-[10px] font-normal">this model only</span>
            </label>
            <input
              className={FIELD_CLS}
              type="number"
              step="1"
              min="1"
              placeholder="No limit"
              value={modelConfig.maxConcurrency != null ? modelConfig.maxConcurrency : ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  updateModelConfig(modelId, { maxConcurrency: undefined });
                } else {
                  const val = Number(raw);
                  if (Number.isFinite(val) && val >= 1) {
                    updateModelConfig(modelId, { maxConcurrency: val });
                  }
                }
              }}
            />
            <span className="font-body text-text-muted text-[11px] italic">
              Limit in-flight requests for this model. Leave empty to use the provider-wide limit or
              no limit.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
