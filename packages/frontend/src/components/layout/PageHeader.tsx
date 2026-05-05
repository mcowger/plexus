import React from 'react';
import { clsx } from 'clsx';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Render below the title/actions row (filters, tabs, etc.). */
  children?: React.ReactNode;
  className?: string;
  /** Sticky to top of scroll container with glass background. Defaults to true. */
  sticky?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  children,
  className,
  sticky = true,
}) => {
  return (
    <div
      className={clsx(
        'px-4 sm:px-6 lg:px-8 py-4',
        sticky && 'sticky top-0 z-20 glass-bg border-b border-white/5',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-heading text-xl sm:text-2xl font-semibold tracking-tight text-text m-0 leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">{actions}</div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
};
