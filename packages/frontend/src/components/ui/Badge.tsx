import React from 'react';
import { clsx } from 'clsx';

type BadgeStatus =
  | 'connected'
  | 'disconnected'
  | 'connecting'
  | 'error'
  | 'neutral'
  | 'warning'
  | 'success'
  | 'danger'
  | 'info'
  | 'violet'
  | 'cyan';

interface BadgeProps {
  status: BadgeStatus;
  children: React.ReactNode;
  secondaryText?: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  style?: React.CSSProperties;
  /** Hide the leading status dot (default shows when secondaryText absent). */
  noDot?: boolean;
}

const statusClasses: Record<BadgeStatus, string> = {
  connected: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/12',
  success: 'text-emerald-300 border-emerald-500/25 bg-emerald-500/12',
  connecting: 'text-sky-300 border-sky-500/25 bg-sky-500/12',
  info: 'text-sky-300 border-sky-500/25 bg-sky-500/12',
  disconnected: 'text-slate-300 border-slate-500/18 bg-slate-500/10',
  neutral: 'text-slate-300 border-slate-500/18 bg-slate-500/10',
  error: 'text-rose-300 border-rose-500/28 bg-rose-500/12',
  danger: 'text-rose-300 border-rose-500/28 bg-rose-500/12',
  warning: 'text-amber-300 border-amber-500/28 bg-amber-500/12',
  violet: 'text-violet-300 border-violet-500/25 bg-violet-500/12',
  cyan: 'text-cyan-300 border-cyan-500/25 bg-cyan-500/12',
};

export const Badge: React.FC<BadgeProps> = ({
  status,
  children,
  secondaryText,
  className,
  onClick,
  title,
  style,
  noDot,
}) => {
  return (
    <div
      onClick={onClick}
      title={title}
      style={style}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap tnum',
        secondaryText ? 'px-2 py-1 text-[11px]' : 'px-2 py-0.5 text-[11px] font-medium',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity duration-fast',
        statusClasses[status],
        className
      )}
    >
      {!noDot && <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />}
      {secondaryText ? (
        <div className="flex flex-col items-start leading-tight">
          <span className="font-semibold">{children}</span>
          <span className="text-[9px] opacity-70 mt-0.5">{secondaryText}</span>
        </div>
      ) : (
        <span className="font-medium">{children}</span>
      )}
    </div>
  );
};
