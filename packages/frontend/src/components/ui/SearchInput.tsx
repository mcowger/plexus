import { Search, X } from 'lucide-react';
import React from 'react';

import { Input } from './Input';

interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  label?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search...',
  label,
  ...rest
}) => {
  const handleClear = () => {
    onChange('');
    onClear?.();
  };

  return (
    <Input
      type="search"
      label={label}
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
            className="text-text-muted hover:text-text hover:bg-bg-hover duration-fast flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          >
            <X size={14} />
          </button>
        ) : null
      }
      {...rest}
    />
  );
};
