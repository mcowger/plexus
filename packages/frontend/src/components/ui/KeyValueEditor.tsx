import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from './Input';
import { Button } from './Button';

type Entries = Record<string, string>;

interface KeyValueEditorProps {
  entries: Entries;
  onChange: (entries: Entries) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  /** Render value as a textarea instead of a single-line input. */
  multilineValue?: boolean;
  emptyText?: string;
}

export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({
  entries,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  addLabel = 'Add',
  multilineValue,
  emptyText,
}) => {
  const keys = Object.keys(entries);

  const updateKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    const next: Entries = {};
    for (const k of keys) {
      next[k === oldKey ? newKey : k] = entries[k] ?? '';
    }
    onChange(next);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  const removeEntry = (key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
  };

  const addEntry = () => {
    let i = 1;
    let candidate = 'key';
    while (candidate in entries) {
      candidate = `key${i++}`;
    }
    onChange({ ...entries, [candidate]: '' });
  };

  return (
    <div className="flex flex-col gap-2">
      {keys.length === 0 && emptyText && (
        <p className="text-xs text-text-muted italic">{emptyText}</p>
      )}
      {keys.map((key) => (
        <div key={key} className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2">
          <div className="flex-1 min-w-0">
            <Input
              defaultValue={key}
              onBlur={(e) => updateKey(key, e.target.value)}
              placeholder={keyPlaceholder}
            />
          </div>
          <div className="flex-[2] min-w-0">
            {multilineValue ? (
              <textarea
                value={entries[key] ?? ''}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder={valuePlaceholder}
                rows={2}
                className="w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-md outline-none transition-all duration-fast backdrop-blur-md placeholder:text-text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 resize-y"
              />
            ) : (
              <Input
                value={entries[key] ?? ''}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder={valuePlaceholder}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => removeEntry(key)}
            aria-label={`Remove ${key}`}
            className="inline-flex items-center justify-center h-10 w-10 flex-shrink-0 rounded-md text-text-muted hover:text-danger hover:bg-red-500/10 transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-danger focus-visible:outline-offset-2"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        leftIcon={<Plus size={14} />}
        onClick={addEntry}
      >
        {addLabel}
      </Button>
    </div>
  );
};
