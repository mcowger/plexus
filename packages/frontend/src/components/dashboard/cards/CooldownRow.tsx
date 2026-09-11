/**
 * @file CooldownRow.tsx
 *
 * Renders a single provider/model cooldown alert row with popover detail dialog.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Info, X } from 'lucide-react';

export interface CooldownRowProps {
  provider: string;
  modelDisplay: string;
  timeDisplay: string;
  consecutiveFailures?: number;
  lastError?: string;
  expiryStr: string;
  onClear: () => void;
}

export const CooldownRow: React.FC<CooldownRowProps> = ({
  provider,
  modelDisplay,
  timeDisplay,
  consecutiveFailures,
  lastError,
  expiryStr,
  onClear,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; right: number } | null>(null);

  const updatePopoverPosition = useCallback(() => {
    const button = infoButtonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const popoverWidth = 288;
    const gutter = 12;
    const right = Math.max(gutter, viewportWidth - rect.right);
    const clampedRight = Math.min(right, Math.max(gutter, viewportWidth - popoverWidth - gutter));

    setPopoverStyle({
      top: rect.bottom + 8,
      right: clampedRight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !(popoverRef.current && popoverRef.current.contains(target))
      ) {
        setOpen(false);
      }
    };
    updatePopoverPosition();
    document.addEventListener('mousedown', handler);
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  return (
    <div
      className="px-3 py-2 flex items-center gap-2 bg-warning/5"
      onClick={(e) => e.stopPropagation()}
    >
      <AlertTriangle size={12} className="text-warning shrink-0" />
      <span className="text-xs font-medium text-text">{provider}</span>
      <span className="text-xs text-text-muted truncate">
        {modelDisplay} — {timeDisplay}
      </span>
      <div className="relative ml-auto shrink-0 flex items-center gap-2" ref={ref}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="text-text-muted hover:text-danger transition-colors"
          title="Clear this cooldown"
        >
          <X size={13} />
        </button>
        <button
          ref={infoButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="text-text-muted hover:text-text transition-colors"
          aria-label="Show cooldown details"
        >
          <Info size={13} />
        </button>
        {open && popoverStyle && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={popoverRef}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-[500] w-72 rounded-md border border-border shadow-lg p-3 text-xs space-y-2"
                style={{
                  backgroundColor: 'rgb(15, 23, 42)',
                  top: popoverStyle.top,
                  right: popoverStyle.right,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold text-warning">
                  <AlertTriangle size={12} />
                  Cooldown Details
                </div>
                {lastError && (
                  <div>
                    <span className="text-text-muted font-medium">Error:</span>
                    <p className="mt-0.5 text-text wrap-break-word whitespace-pre-wrap font-mono text-[11px] bg-bg-hover rounded p-1.5 max-h-32 overflow-y-auto">
                      {lastError}
                    </p>
                  </div>
                )}
                {consecutiveFailures !== undefined && (
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Consecutive failures</span>
                    <span className="font-semibold text-danger">{consecutiveFailures}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-text-muted">Expires at</span>
                  <span className="font-semibold text-text text-right">{expiryStr}</span>
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
};
