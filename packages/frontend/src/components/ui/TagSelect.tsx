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
}

export const TagSelect: React.FC<TagSelectProps> = ({
  label,
  placeholder = 'Select...',
  options,
  selected,
  onChange,
  className,
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selected.length === 0 ? placeholder : 'Search...'}
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
            {filteredOptions.length === 0 && (
              <div className="px-3.5 py-2.5 text-xs text-text-muted">
                {search ? 'No matches found' : 'All items selected'}
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
                onClick={() => handleToggle(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
