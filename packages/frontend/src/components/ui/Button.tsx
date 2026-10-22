import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';
import React from 'react';

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
        'font-body duration-fast inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border-0 leading-normal font-medium whitespace-nowrap transition-all outline-none select-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0',
        {
          'from-secondary to-primary bg-gradient-to-br text-[#1A1006] shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_20px_-10px_rgba(245,158,11,0.5)] hover:-translate-y-px hover:shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_12px_28px_-10px_rgba(245,158,11,0.65)] hover:brightness-105':
            variant === 'primary',
          'text-text border-border-2 border bg-slate-700/50 hover:bg-slate-600/60':
            variant === 'secondary',
          'text-text-secondary hover:bg-bg-hover hover:text-text bg-transparent':
            variant === 'ghost',
          'bg-danger/12 border-danger/30 hover:bg-danger/20 border text-red-300':
            variant === 'danger',
          'gap-1.5 px-2.5 py-1.5 text-xs': size === 'sm',
          'gap-1.5 px-3.5 py-2 text-sm': size === 'md',
          'px-4 py-2.5 text-sm': size === 'lg',
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
