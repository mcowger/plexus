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
        'glass-bg backdrop-blur-md rounded-lg overflow-hidden transition-all duration-fast max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.25)]',
        className
      )}
      {...props}
    >
      {(title || extra) && (
        <div
          className={clsx(
            'flex items-center justify-between gap-3 border-b border-border-glass',
            dense ? 'px-4 py-3' : 'px-4 py-4 sm:px-5 sm:py-4'
          )}
        >
          {title && (
            <h3 className="font-heading text-h3 font-semibold text-text m-0 truncate">{title}</h3>
          )}
          {extra && <div className="flex-shrink-0">{extra}</div>}
        </div>
      )}
      {!flush && (
        <div className={clsx('max-w-full', dense ? 'p-3 sm:p-4' : 'p-4 sm:p-5 md:p-6')}>
          {children}
        </div>
      )}
      {flush && <div className="max-w-full">{children}</div>}
    </div>
  );
};
