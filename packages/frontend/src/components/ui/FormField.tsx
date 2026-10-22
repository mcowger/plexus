import { clsx } from 'clsx';
import React from 'react';

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
            'font-body text-text-secondary text-xs font-medium',
            inline && 'flex-shrink-0'
          )}
        >
          {label}
        </label>
      )}
      <div className={clsx('flex flex-col gap-1', inline && 'min-w-0 flex-1')}>
        {children}
        {error && <span className="text-danger text-xs">{error}</span>}
        {!error && hint && <span className="text-text-muted text-xs">{hint}</span>}
      </div>
    </div>
  );
};
