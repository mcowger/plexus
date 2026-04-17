import React from 'react';
import { clsx } from 'clsx';

interface PageContainerProps {
  children: React.ReactNode;
  /** Constrain content width. Defaults to wide. */
  width?: 'narrow' | 'standard' | 'wide' | 'full';
  className?: string;
}

const widthClasses: Record<NonNullable<PageContainerProps['width']>, string> = {
  narrow: 'max-w-3xl',
  standard: 'max-w-5xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
};

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  width = 'wide',
  className,
}) => {
  return <div className={clsx('mx-auto w-full', widthClasses[width], className)}>{children}</div>;
};
