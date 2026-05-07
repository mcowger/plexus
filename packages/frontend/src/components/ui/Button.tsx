import React from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading,
  leftIcon,
  disabled,
  ...props
}) => {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-body font-medium leading-normal border-0 rounded-md cursor-pointer transition-all duration-fast whitespace-nowrap select-none outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
        {
          'text-[#1A1006] bg-gradient-to-br from-secondary to-primary shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_20px_-10px_rgba(245,158,11,0.5)] hover:brightness-105 hover:-translate-y-px hover:shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_12px_28px_-10px_rgba(245,158,11,0.65)]':
            variant === 'primary',
          'bg-slate-700/50 text-text border border-border-2 hover:bg-slate-600/60':
            variant === 'secondary',
          'bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text':
            variant === 'ghost',
          'bg-danger/12 text-red-300 border border-danger/30 hover:bg-danger/20':
            variant === 'danger',
          'py-1.5 px-2.5 text-xs gap-1.5': size === 'sm',
          'py-2 px-3.5 text-sm gap-1.5': size === 'md',
          'py-2.5 px-4 text-sm': size === 'lg',
          'h-8 w-8 p-0': size === 'icon',
        },
        className
      )}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin" size={14} />}
      {!isLoading && leftIcon && <span className="flex items-center">{leftIcon}</span>}
      {children}
    </button>
  );
};
