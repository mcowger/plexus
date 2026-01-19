import React from 'react';
import { clsx } from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className, id, ...props }) => {
  const inputId = id || props.name || Math.random().toString(36).substr(2, 9);

  return (
    <div className={clsx('flex flex-col gap-2', { 'input-has-error': !!error })}>
      {label && (
        <label htmlFor={inputId} className="font-body text-[13px] font-medium text-text-secondary whitespace-nowrap">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx('w-full py-2.5 px-3.5 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]', className)}
        {...props}
      />
      {error && <span className="text-danger text-xs mt-1">{error}</span>}
    </div>
  );
};
