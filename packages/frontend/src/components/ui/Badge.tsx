import React from 'react';
import { clsx } from 'clsx';

type BadgeStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'neutral' | 'warning';

interface BadgeProps {
  status: BadgeStatus;
  children: React.ReactNode;
  secondaryText?: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

const statusClasses: Record<BadgeStatus, string> = {
  connected: 'text-success border-success/30 bg-success/15',
  connecting: 'text-info border-info/30 bg-info/15',
  disconnected: 'text-danger border-danger/30 bg-danger/15',
  error: 'text-danger border-danger/30 bg-danger/15',
  warning: 'text-secondary border-secondary/30 bg-secondary/15',
  neutral: 'text-text-secondary border-border bg-bg-hover',
};

export const Badge: React.FC<BadgeProps> = ({
  status,
  children,
  secondaryText,
  className,
  onClick,
  title,
}) => {
  return (
    <div
      onClick={onClick}
      title={title}
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border text-xs font-medium whitespace-nowrap',
        secondaryText ? 'px-3 py-1' : 'px-3 py-1.5',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity duration-fast',
        statusClasses[status],
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
      <div className="flex flex-col items-start leading-tight">
        <span className="font-semibold">{children}</span>
        {secondaryText && <span className="text-[9px] opacity-70 mt-0.5">{secondaryText}</span>}
      </div>
    </div>
  );
};
