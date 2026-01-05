import React from 'react';
import { clsx } from 'clsx';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  extra?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, extra, children, className, ...props }) => {
  return (
    <div className={clsx('glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)]', className)} {...props}>
      {(title || extra) && (
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          {title && <h3 className="font-heading text-lg font-semibold text-text m-0">{title}</h3>}
          {extra && <div className="card-extra">{extra}</div>}
        </div>
      )}
      <div className="p-6 max-w-full">{children}</div>
    </div>
  );
};
