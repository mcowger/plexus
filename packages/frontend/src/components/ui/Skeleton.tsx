import React from 'react';
import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  height?: number | string;
  width?: number | string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  height,
  width,
  rounded = 'md',
}) => {
  const style: React.CSSProperties = {};
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height;
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width;

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      style={style}
      className={clsx(
        'animate-pulse bg-bg-hover/60',
        {
          'rounded-sm': rounded === 'sm',
          'rounded-md': rounded === 'md',
          'rounded-lg': rounded === 'lg',
          'rounded-full': rounded === 'full',
        },
        className
      )}
    />
  );
};

export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className,
}) => (
  <div className={clsx('flex flex-col gap-2', className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} height={12} width={i === lines - 1 ? '60%' : '100%'} />
    ))}
  </div>
);
