import React, { useState } from 'react';
import { clsx } from 'clsx';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'bottom' | 'right' | 'top' | 'left';
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
            'absolute z-[500] px-2 py-1 bg-bg-surface border border-border-2 rounded-md shadow-lg whitespace-nowrap text-[11px] text-text pointer-events-none font-mono',
            position === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-2',
            position === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-2',
            position === 'top' && 'bottom-full left-1/2 -translate-x-1/2 mb-2',
            position === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-2'
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
};
