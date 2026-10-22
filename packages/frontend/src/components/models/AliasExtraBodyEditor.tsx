import { Plus, Trash2 } from 'lucide-react';

import type { Alias } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface Props {
  editingAlias: Alias;
  setEditingAlias: React.Dispatch<React.SetStateAction<Alias>>;
}

export function AliasExtraBodyEditor({ editingAlias, setEditingAlias }: Props) {
  const entries = Object.entries(editingAlias.extraBody || {});

  const addKV = () => {
    setEditingAlias((prev) => ({
      ...prev,
      extraBody: { ...(prev.extraBody || {}), '': '' },
    }));
  };

  const updateKV = (oldKey: string, newKey: string, value: any) => {
    setEditingAlias((prev) => {
      const current = { ...(prev.extraBody || {}) };
      if (oldKey !== newKey) {
        delete current[oldKey];
      }
      current[newKey] = value;
      return { ...prev, extraBody: current };
    });
  };

  const removeKV = (key: string) => {
    setEditingAlias((prev) => {
      const current = { ...(prev.extraBody || {}) };
      delete current[key];
      return { ...prev, extraBody: current };
    });
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <label className="font-body text-text-secondary text-[13px] font-medium">
          Extra Body Fields
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge status="neutral" style={{ fontSize: '10px', padding: '2px 8px' }}>
            {entries.length}
          </Badge>
          <Button
            size="sm"
            variant="secondary"
            style={{ padding: '2px 6px', lineHeight: 1 }}
            onClick={addKV}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
      <p className="font-body text-text-muted text-[11px]" style={{ marginBottom: '6px' }}>
        These key-value pairs are merged into every request dispatched through this alias,
        overriding any provider-level or model-level extra body fields with the same keys.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {entries.length === 0 && (
          <div className="font-body text-text-secondary text-[11px] italic">
            No extra body fields configured.
          </div>
        )}
        {entries.map(([key, val]: [string, any], idx: number) => (
          <div key={idx} style={{ display: 'flex', gap: '6px' }}>
            <Input
              placeholder="Field Name"
              value={key}
              onChange={(e) => updateKV(key, e.target.value, val)}
              style={{ flex: 1 }}
            />
            <Input
              placeholder="Value"
              value={typeof val === 'object' ? JSON.stringify(val) : String(val)}
              onChange={(e) => {
                const raw = e.target.value;
                let parsed: any = raw;
                try {
                  parsed = JSON.parse(raw);
                } catch {
                  // keep as string
                }
                updateKV(key, key, parsed);
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeKV(key)}
              style={{ padding: '4px' }}
            >
              <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
