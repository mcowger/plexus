import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'bottom' | 'right' | 'top' | 'left';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'bottom' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible || !triggerRef.current) return;

    const updatePosition = () => {
      if (!triggerRef.current) return;

      const rect = triggerRef.current.getBoundingClientRect();
      const gap = 8;
      const baseStyle: React.CSSProperties = {
        position: 'fixed',
        zIndex: 500,
      };

      setTooltipStyle(
        position === 'right'
          ? {
              ...baseStyle,
              left: rect.right + gap,
              top: rect.top + rect.height / 2,
              transform: 'translateY(-50%)',
            }
          : position === 'left'
            ? {
                ...baseStyle,
                left: rect.left - gap,
                top: rect.top + rect.height / 2,
                transform: 'translate(-100%, -50%)',
              }
            : position === 'top'
              ? {
                  ...baseStyle,
                  left: rect.left + rect.width / 2,
                  top: rect.top - gap,
                  transform: 'translate(-50%, -100%)',
                }
              : {
                  ...baseStyle,
                  left: rect.left + rect.width / 2,
                  top: rect.bottom + gap,
                  transform: 'translateX(-50%)',
                }
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isVisible, position]);

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={tooltipStyle}
            className={clsx(
              'px-2 py-1 bg-bg-surface border border-border-2 rounded-md shadow-lg whitespace-nowrap text-[11px] text-text pointer-events-none font-mono'
            )}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
};
