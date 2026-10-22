import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import React from 'react';

interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

interface SelectProps<V extends string = string> extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange'
> {
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
        <label htmlFor={selectId} className="font-body text-text-secondary text-xs font-medium">
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
            'font-body text-text duration-fast w-full cursor-pointer appearance-none rounded-md border bg-slate-900/60 py-2 pr-9 pl-3 text-sm transition-all outline-none',
            'hover:border-border-2',
            'focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-danger' : 'border-border',
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
          size={14}
          className="text-text-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
        />
      </div>
      {error && <span className="text-danger text-xs">{error}</span>}
    </div>
  );
}
