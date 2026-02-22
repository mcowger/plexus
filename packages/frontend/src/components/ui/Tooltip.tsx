import React, { useState } from 'react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: 'bottom' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'bottom' }) => {
  const [isVisible, setIsVisible] = useState(false);

  const positionStyles =
    position === 'right'
      ? {
          left: '100%',
          top: '50%',
          transform: 'translateY(-50%)',
          marginLeft: '8px',
        }
      : {
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: '8px',
        };

  return (
    <div
      className="tooltip-container"
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className="tooltip-content"
          style={{
            position: 'absolute',
            ...positionStyles,
            padding: '8px 12px',
            backgroundColor: '#1e1e1e',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            zIndex: 1000,
            opacity: 1,
            visibility: 'visible',
            whiteSpace: 'nowrap',
            fontSize: '0.85em',
            color: 'var(--color-text-primary)',
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
};
