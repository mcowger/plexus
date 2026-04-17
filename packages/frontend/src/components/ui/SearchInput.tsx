import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from './Input';

interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search...',
  ...rest
}) => {
  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      leadingIcon={<Search size={16} />}
      trailingAction={
        value ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="flex items-center justify-center h-7 w-7 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors duration-fast"
          >
            <X size={14} />
          </button>
        ) : null
      }
      {...rest}
    />
  );
};
