import React from 'react';
import { clsx } from 'clsx';

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
        dense ? 'py-8 px-4' : 'py-12 sm:py-16 px-6',
        className
      )}
    >
      {icon && (
        <div className="mb-4 text-text-muted [&>svg]:h-10 [&>svg]:w-10 [&>svg]:sm:h-12 [&>svg]:sm:w-12">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-h3 font-semibold text-text m-0">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md font-body text-sm text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
};
