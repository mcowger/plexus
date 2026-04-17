import React from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface SelectProps<V extends string = string>
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  label?: string;
  error?: string;
  placeholder?: string;
}

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  label,
  error,
  placeholder,
  className,
  id,
  ...rest
}: SelectProps<V>) {
  const generatedId = React.useId();
  const selectId = id || generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="font-body text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value as V)}
          aria-invalid={!!error}
          className={clsx(
            'w-full appearance-none py-2.5 pl-3.5 pr-10 font-body text-sm text-text bg-bg-glass border rounded-md outline-none transition-all duration-fast backdrop-blur-md cursor-pointer',
            'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error ? 'border-danger' : 'border-border-glass',
            className
          )}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
      </div>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  );
}
