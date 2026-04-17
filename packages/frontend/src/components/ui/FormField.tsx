import React from 'react';
import { clsx } from 'clsx';

interface FormFieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  /** Render label & control horizontally (label left, control right). */
  inline?: boolean;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  hint,
  error,
  children,
  htmlFor,
  inline,
  className,
}) => {
  return (
    <div
      className={clsx(
        'flex gap-2',
        inline ? 'flex-row items-center justify-between' : 'flex-col',
        className
      )}
    >
      {label && (
        <label
          htmlFor={htmlFor}
          className={clsx(
            'font-body text-xs font-medium text-text-secondary',
            inline && 'flex-shrink-0'
          )}
        >
          {label}
        </label>
      )}
      <div className={clsx('flex flex-col gap-1', inline && 'min-w-0 flex-1')}>
        {children}
        {error && <span className="text-xs text-danger">{error}</span>}
        {!error && hint && <span className="text-xs text-text-muted">{hint}</span>}
      </div>
    </div>
  );
};
