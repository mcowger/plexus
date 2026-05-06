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
        'px-3 py-3 sm:px-6 sm:py-4 lg:px-8',
        // On mobile the AppBar (h-12, top-0, sticky) sits above the page content,
        // so the page header has to start below it. On md+ the AppBar is hidden.
        sticky && 'sticky top-12 md:top-0 z-20 bg-bg-card border-b border-border',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-heading text-lg sm:text-2xl font-semibold tracking-tight text-text m-0 leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] sm:text-xs text-text-secondary mt-0.5">{subtitle}</p>
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
