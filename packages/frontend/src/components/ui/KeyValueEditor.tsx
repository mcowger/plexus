import { Plus, Trash2 } from 'lucide-react';
import React from 'react';

import { Button } from './Button';
import { Input } from './Input';

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
        <p className="text-text-muted text-xs italic">{emptyText}</p>
      )}
      {keys.map((key) => (
        <div key={key} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <Input
              defaultValue={key}
              onBlur={(e) => updateKey(key, e.target.value)}
              placeholder={keyPlaceholder}
            />
          </div>
          <div className="min-w-0 flex-[2]">
            {multilineValue ? (
              <textarea
                value={entries[key] ?? ''}
                onChange={(e) => updateValue(key, e.target.value)}
                placeholder={valuePlaceholder}
                rows={2}
                className="font-body text-text bg-bg-glass border-border-glass duration-fast placeholder:text-text-muted focus-visible:border-primary focus-visible:ring-primary/25 w-full resize-y rounded-md border px-3.5 py-2.5 text-sm backdrop-blur-md transition-all outline-none focus-visible:ring-2"
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
            className="text-text-muted hover:text-danger duration-fast focus-visible:outline-danger inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-red-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
