import React, { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, X } from 'lucide-react';

interface TagSelectProps {
  label?: string;
  placeholder?: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
  /**
   * When true, users can add free-form values that aren't in `options`.
   * Pressing Enter or typing a comma commits the current search text as a
   * new tag, and the dropdown shows a "Create '<search>'" affordance.
   */
  allowCustom?: boolean;
}

export const TagSelect: React.FC<TagSelectProps> = ({
  label,
  placeholder = 'Select...',
  options,
  selected,
  onChange,
  className,
  allowCustom = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when opening
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const filteredOptions = options.filter(
    (opt) => opt.toLowerCase().includes(search.toLowerCase()) && !selected.includes(opt)
  );

  const handleToggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const handleRemove = (option: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selected.filter((s) => s !== option));
  };

  const handleContainerClick = () => {
    setIsOpen(true);
  };

  // Add one or more free-form tags in a single onChange call. Skips empty,
  // duplicate, and already-selected values. Does NOT touch `search` — callers
  // decide whether to clear the input.
  const addCustomTags = (raws: string[]) => {
    const seen = new Set(selected);
    const toAdd: string[] = [];
    for (const raw of raws) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      toAdd.push(value);
    }
    if (toAdd.length > 0) onChange([...selected, ...toAdd]);
  };

  // Commit the current search text as a new free-form tag. No-ops if the
  // value is empty (after trim) or already selected.
  const commitCustom = (raw: string) => {
    addCustomTags([raw]);
    setSearch('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!allowCustom) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitCustom(search);
    } else if (e.key === 'Backspace' && search === '' && selected.length > 0) {
      // Quality-of-life: backspace on empty input peels off the last tag.
      onChange(selected.slice(0, -1));
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    // Commit on comma even inside onChange (handles paste of "a, b, c"). Batch
    // all new tags into a single onChange so later calls don't overwrite
    // earlier ones via the stale `selected` snapshot.
    if (allowCustom && next.includes(',')) {
      const parts = next.split(',');
      const tail = parts.pop() ?? '';
      addCustomTags(parts);
      setSearch(tail);
      return;
    }
    setSearch(next);
  };

  const searchTrimmed = search.trim();
  const showCreateOption =
    allowCustom &&
    searchTrimmed.length > 0 &&
    !selected.includes(searchTrimmed) &&
    !options.some((o) => o.toLowerCase() === searchTrimmed.toLowerCase());

  return (
    <div className={clsx('flex flex-col gap-2', className)} ref={containerRef}>
      {label && (
        <label className="font-body text-[13px] font-medium text-text-secondary whitespace-nowrap">
          {label}
        </label>
      )}
      <div
        className={clsx(
          'w-full py-2.5 px-3.5 font-body text-sm bg-bg-glass border rounded-sm outline-none transition-all duration-200 backdrop-blur-md cursor-text min-h-[42px] flex flex-wrap items-center gap-1.5',
          isOpen
            ? 'border-primary shadow-[0_0_0_3px_rgba(245,158,11,0.15)]'
            : 'border-border-glass hover:border-border-glass'
        )}
        onClick={handleContainerClick}
      >
        {selected.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md bg-primary/15 text-primary border border-primary/30 whitespace-nowrap"
          >
            {tag}
            <button
              type="button"
              className="bg-transparent border-0 p-0 m-0 cursor-pointer text-primary/70 hover:text-primary leading-none"
              onClick={(e) => handleRemove(tag, e)}
              title={`Remove ${tag}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {isOpen ? (
          <input
            ref={searchInputRef}
            className="flex-1 min-w-[80px] bg-transparent border-0 outline-none text-text text-sm p-0 placeholder:text-text-muted"
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            onBlur={() => {
              if (allowCustom) commitCustom(search);
            }}
            placeholder={
              selected.length === 0 ? placeholder : allowCustom ? 'Type to add...' : 'Search...'
            }
          />
        ) : (
          <span className="text-text-muted text-sm flex-1">
            {selected.length === 0 ? placeholder : ''}
          </span>
        )}
        <ChevronDown
          size={14}
          className={clsx(
            'text-text-muted ml-auto shrink-0 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </div>

      {isOpen && (
        <div className="relative -mt-1">
          <div className="absolute z-50 w-full max-h-52 overflow-y-auto bg-bg-surface border border-border-glass rounded-sm shadow-lg">
            {filteredOptions.length === 0 && !showCreateOption && (
              <div className="px-3.5 py-2.5 text-xs text-text-muted">
                {search
                  ? 'No matches found'
                  : allowCustom
                    ? 'Type to add a new tag'
                    : 'All items selected'}
              </div>
            )}
            {filteredOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={clsx(
                  'w-full text-left px-3.5 py-2 text-sm font-body cursor-pointer transition-colors',
                  'hover:bg-bg-hover text-text'
                )}
                onMouseDown={(e) => {
                  // Use onMouseDown so the click registers before the input
                  // blur handler fires. Otherwise, onBlur's commitCustom(search)
                  // would add the partial search text as a new tag before the
                  // suggestion is selected.
                  e.preventDefault();
                  handleToggle(option);
                }}
              >
                {option}
              </button>
            ))}
            {showCreateOption && (
              <button
                type="button"
                key={`__create__${searchTrimmed}`}
                className="w-full text-left px-3.5 py-2 text-sm font-body cursor-pointer transition-colors hover:bg-bg-hover text-text border-t border-border-glass"
                onMouseDown={(e) => {
                  // Use onMouseDown so the click registers before the input
                  // blur handler fires and closes the dropdown.
                  e.preventDefault();
                  commitCustom(searchTrimmed);
                }}
              >
                <span className="text-text-muted">Create </span>
                <span className="font-medium">&quot;{searchTrimmed}&quot;</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
