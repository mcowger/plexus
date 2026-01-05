import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled, size = 'md' }) => {
  const width = size === 'sm' ? 32 : 44;
  const height = size === 'sm' ? 18 : 24;
  const knobSize = size === 'sm' ? 14 : 20;
  const padding = 2;

  // Fallback colors if vars aren't available, but assuming they are based on index.css
  const bgOn = 'var(--color-success, #10B981)'; // Using success color for ON state usually looks good
  const bgOff = 'var(--color-bg-subtle, #334155)'; 

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: checked ? bgOn : bgOff,
        borderRadius: '999px',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.2s ease',
        border: checked ? '1px solid transparent' : '1px solid var(--color-border-glass, rgba(255,255,255,0.1))',
        flexShrink: 0
      }}
    >
      <div
        style={{
            position: 'absolute',
            top: `${padding - (checked ? 0 : 1)}px`, // Adjust for border offset if needed, simplified here
            left: checked ? `${width - knobSize - padding - (checked ? 0 : 2)}px` : `${padding}px`,
            width: `${knobSize}px`,
            height: `${knobSize}px`,
            background: 'white',
            borderRadius: '50%',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
        }}
      />
    </div>
  );
};