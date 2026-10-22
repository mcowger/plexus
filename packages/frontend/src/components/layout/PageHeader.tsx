import { clsx } from 'clsx';
import React from 'react';

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
        sticky && 'bg-bg-card border-border sticky top-12 z-20 border-b md:top-0',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-text m-0 text-lg leading-tight font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {subtitle && (
            <p className="text-text-secondary mt-0.5 text-[11px] sm:text-xs">{subtitle}</p>
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
