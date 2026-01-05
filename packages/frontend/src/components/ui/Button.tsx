import React from 'react';
import { clsx } from 'clsx';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
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
        'inline-flex items-center justify-center gap-2 py-2.5 px-5 font-body text-sm font-medium leading-normal border-0 rounded-md cursor-pointer transition-all duration-200 whitespace-nowrap select-none outline-none disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'text-black shadow-md bg-gradient-to-br from-primary to-secondary shadow-[0_4px_12px_rgba(245,158,11,0.3)] hover:disabled:transform-none hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)]': variant === 'primary',
          'bg-bg-glass text-text border border-border-glass backdrop-blur-md hover:bg-bg-hover hover:border-primary': variant === 'secondary',
          'bg-transparent text-text border-0 hover:bg-amber-500/10': variant === 'ghost',
          'bg-danger text-white shadow-md shadow-[0_4px_12px_rgba(239,68,68,0.3)] hover:bg-red-700 hover:-translate-y-0.5': variant === 'danger',
          '!py-1.5 !px-3.5 !text-xs': size === 'sm',
        },
        className
      )}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="animate-spin" size={16} />}
      {!isLoading && leftIcon && <span className="flex items-center">{leftIcon}</span>}
      {children}
    </button>
  );
};
