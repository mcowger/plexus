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
}

export function ModelAdvanced({
  modelId,
  modelConfig,
  isOpen,
  setIsOpen,
  updateModelConfig,
}: Props) {
  return (
    <div className="border border-border-glass rounded-md overflow-hidden">
      <div
        className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
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
            <label className="flex items-start gap-2 py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={modelConfig.auto_compat === true}
                onChange={(e) =>
                  updateModelConfig(modelId, {
                    auto_compat: e.target.checked ? true : undefined,
                  })
                }
              />
              <div>
                <div className="font-body text-[12px] text-text">Auto Compat</div>
                <div className="font-body text-[11px] text-text-muted" style={{ lineHeight: 1.35 }}>
                  Use pi-ai registry hints for this model.
                </div>
              </div>
            </label>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-body text-[11px] font-medium text-text-secondary">
              Max Concurrency
              <span className="font-normal text-[10px] text-text-muted ml-1">this model only</span>
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
            <span className="font-body text-[11px] text-text-muted italic">
              Limit in-flight requests for this model. Leave empty to use the provider-wide limit or
              no limit.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
