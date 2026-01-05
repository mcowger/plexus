import React from 'react';
import { clsx } from 'clsx';

interface BadgeProps {
  status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'neutral' | 'warning';
  children: React.ReactNode;
  secondaryText?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({ status, children, secondaryText, className, style }) => {
  return (
    <div className={clsx('inline-flex items-center gap-2 py-1.5 px-3 rounded-xl text-xs font-medium', 
        {
            'text-success border border-success/30 bg-emerald-500/15': status === 'connected',
            'text-danger border border-danger/30 bg-red-500/15': status === 'disconnected' || status === 'error',
            'text-secondary border border-secondary/30 bg-amber-500/15': status === 'warning',
        }, className)} style={{ ...style, height: secondaryText ? 'auto' : undefined, padding: secondaryText ? '4px 12px' : undefined }}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
            <span style={{ fontWeight: 600 }}>{children}</span>
            {secondaryText && <span style={{ fontSize: '9px', opacity: 0.7, marginTop: '2px' }}>{secondaryText}</span>}
        </div>
    </div>
  );
};
