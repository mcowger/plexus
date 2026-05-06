import React from 'react';
import { clsx } from 'clsx';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  extra?: React.ReactNode;
  /** Use a minimal variant with less padding. */
  dense?: boolean;
  /** Remove default body padding so caller can control layout. */
  flush?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  extra,
  children,
  className,
  dense,
  flush,
  ...props
}) => {
  return (
    <div
      className={clsx(
        'bg-bg-card border border-border rounded-lg overflow-hidden transition-all duration-fast max-w-full',
        className
      )}
      {...props}
    >
      {(title || extra) && (
        <div
          className={clsx(
            // flex-wrap so a long `extra` (e.g. "Analyze Concurrency" + auto-refresh
            // status) drops to its own line on narrow viewports instead of
            // overflowing the card.
            'flex items-start justify-between gap-2 sm:gap-3 flex-wrap border-b border-border sm:items-center',
            dense ? 'px-3 py-2.5 sm:px-4 sm:py-3' : 'px-3 py-2.5 sm:px-5 sm:py-3'
          )}
        >
          {title && (
            <h3 className="font-heading text-[13px] sm:text-sm font-semibold text-text m-0 truncate min-w-0 leading-tight">
              {title}
            </h3>
          )}
          {extra && (
            <div className="min-w-0 max-w-full flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              {extra}
            </div>
          )}
        </div>
      )}
      {!flush && (
        <div className={clsx('max-w-full', dense ? 'p-3 sm:p-4' : 'p-3 sm:p-5')}>{children}</div>
      )}
      {flush && <div className="max-w-full">{children}</div>}
    </div>
  );
};
