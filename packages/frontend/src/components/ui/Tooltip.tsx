import React, { useState } from 'react';
import { clsx } from 'clsx';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'bottom' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'bottom' }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={clsx(
            'absolute z-tooltip px-3 py-2 bg-bg-surface border border-border rounded-md shadow-lg whitespace-nowrap text-xs text-text pointer-events-none',
            position === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
            position === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-2'
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
};
