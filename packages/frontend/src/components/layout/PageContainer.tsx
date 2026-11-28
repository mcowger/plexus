import { clsx } from 'clsx';
import React from 'react';

interface PageContainerProps {
  children: React.ReactNode;
  /** Constrain content width. Defaults to full. */
  width?: 'narrow' | 'standard' | 'wide' | 'full';
  className?: string;
  /**
   * Edge-to-edge on desktop (lg+): no page padding, and direct children
   * (typically a single flush Card) lose their rounding and border.
   */
  bleed?: boolean;
}

const widthClasses: Record<NonNullable<PageContainerProps['width']>, string> = {
  narrow: 'max-w-3xl',
  standard: 'max-w-5xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
};

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  width = 'full',
  className,
  bleed,
}) => {
  return (
    <div
      className={clsx(
        'mx-auto w-full min-w-0 p-3 sm:p-6',
        bleed ? 'lg:p-0 lg:*:rounded-none lg:*:border-0' : 'lg:p-8',
        widthClasses[width],
        className
      )}
    >
      {children}
    </div>
  );
};
