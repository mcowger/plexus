import { clsx } from 'clsx';
import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  dense?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
  dense,
}) => {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        dense ? 'px-4 py-8' : 'px-6 py-12 sm:py-16',
        className
      )}
    >
      {icon && (
        <div className="text-text-muted mb-4 [&>svg]:h-10 [&>svg]:w-10 [&>svg]:sm:h-12 [&>svg]:sm:w-12">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-h3 text-text m-0 font-semibold">{title}</h3>
      {description && (
        <p className="font-body text-text-secondary mt-2 max-w-md text-sm">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
};
