import React from 'react';

interface PlexusMarkProps {
  size?: number;
  className?: string;
}

let counter = 0;

export const PlexusMark: React.FC<PlexusMarkProps> = ({ size = 28, className }) => {
  const id = React.useMemo(() => `plexus-mark-${++counter}`, []);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="44" y2="44">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth="1.6" fill="none">
        <line x1="22" y1="6" x2="6" y2="16" />
        <line x1="22" y1="6" x2="38" y2="16" />
        <line x1="6" y1="16" x2="22" y2="38" />
        <line x1="38" y1="16" x2="22" y2="38" />
        <line x1="6" y1="16" x2="38" y2="16" />
        <line x1="22" y1="6" x2="22" y2="38" />
      </g>
      <circle cx="22" cy="6" r="3" fill={`url(#${id})`} />
      <circle cx="6" cy="16" r="3" fill={`url(#${id})`} />
      <circle cx="38" cy="16" r="3" fill={`url(#${id})`} />
      <circle cx="22" cy="38" r="3" fill={`url(#${id})`} />
    </svg>
  );
};
