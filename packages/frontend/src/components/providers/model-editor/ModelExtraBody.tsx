import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { DebouncedInput } from '../../ui/DebouncedInput';
import type { ModelConfig } from './types';

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  addModelKV: (modelId: string) => void;
  updateModelKV: (modelId: string, oldKey: string, newKey: string, value: any) => void;
  removeModelKV: (modelId: string, key: string) => void;
}

export function ModelExtraBody({
  modelId,
  modelConfig,
  isOpen,
  setIsOpen,
  addModelKV,
  updateModelKV,
  removeModelKV,
}: Props) {
  return (
    <div className="border border-border-glass rounded-md overflow-hidden">
      <div
        className="p-2 px-3 flex items-center gap-2 cursor-pointer bg-bg-hover hover:bg-bg-glass"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-body text-[12px] font-medium text-text-secondary flex-1">
          Extra Body Fields
        </span>
        <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
          {Object.keys(modelConfig.extraBody || {}).length}
        </Badge>
        <Button
          size="sm"
          variant="secondary"
          style={{ padding: '2px 6px', lineHeight: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            addModelKV(modelId);
            setIsOpen(true);
          }}
        >
          <Plus size={14} />
        </Button>
      </div>
      {isOpen && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '8px',
            borderTop: '1px solid var(--color-border-glass)',
            background: 'var(--color-bg-subtle)',
          }}
        >
          {Object.entries(modelConfig.extraBody || {}).length === 0 && (
            <div className="font-body text-[11px] text-text-secondary italic">
              No extra body fields configured.
            </div>
          )}
          {Object.entries(modelConfig.extraBody || {}).map(
            ([key, val]: [string, any], idx: number) => (
              <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                <DebouncedInput
                  placeholder="Field Name"
                  value={key}
                  onChange={(newKey: string) => updateModelKV(modelId, key, newKey, val)}
                  style={{ flex: 1 }}
                />
                <DebouncedInput
                  placeholder="Value"
                  value={typeof val === 'object' ? JSON.stringify(val) : String(val)}
                  onChange={(val: string) => {
                    try {
                      updateModelKV(modelId, key, key, JSON.parse(val));
                    } catch {
                      updateModelKV(modelId, key, key, val);
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeModelKV(modelId, key)}
                  style={{ padding: '4px' }}
                >
                  <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
