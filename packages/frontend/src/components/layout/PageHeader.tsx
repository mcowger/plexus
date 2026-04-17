import React from 'react';
import { clsx } from 'clsx';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, className }) => {
  return (
    <div
      className={clsx(
        'mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="font-heading text-h1 font-bold text-text m-0 leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 font-body text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 sm:flex-shrink-0">{actions}</div>
      )}
    </div>
  );
};
