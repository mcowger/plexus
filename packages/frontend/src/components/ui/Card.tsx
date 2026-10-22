import { clsx } from 'clsx';
import React from 'react';

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
        'bg-bg-card border-border duration-fast max-w-full overflow-hidden rounded-lg border transition-all',
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
            'border-border flex flex-wrap items-start justify-between gap-2 border-b sm:items-center sm:gap-3',
            dense ? 'px-3 py-2.5 sm:px-4 sm:py-3' : 'px-3 py-2.5 sm:px-5 sm:py-3'
          )}
        >
          {title && (
            <h3 className="font-heading text-text m-0 min-w-0 truncate text-[13px] leading-tight font-semibold sm:text-sm">
              {title}
            </h3>
          )}
          {extra && (
            <div className="flex max-w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
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
