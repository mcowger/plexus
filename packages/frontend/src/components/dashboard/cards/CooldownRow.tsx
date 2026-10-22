/**
 * @file CooldownRow.tsx
 *
 * Renders a single provider/model cooldown alert row with popover detail dialog.
 */

import { AlertTriangle, Info, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
      className="bg-warning/5 flex items-center gap-2 px-3 py-2"
      onClick={(e) => e.stopPropagation()}
    >
      <AlertTriangle size={12} className="text-warning shrink-0" />
      <span className="text-text text-xs font-medium">{provider}</span>
      <span className="text-text-muted truncate text-xs">
        {modelDisplay} — {timeDisplay}
      </span>
      <div className="relative ml-auto flex shrink-0 items-center gap-2" ref={ref}>
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
                className="border-border fixed z-[500] w-72 space-y-2 rounded-md border p-3 text-xs shadow-lg"
                style={{
                  backgroundColor: 'rgb(15, 23, 42)',
                  top: popoverStyle.top,
                  right: popoverStyle.right,
                }}
              >
                <div className="text-warning flex items-center gap-1.5 font-semibold">
                  <AlertTriangle size={12} />
                  Cooldown Details
                </div>
                {lastError && (
                  <div>
                    <span className="text-text-muted font-medium">Error:</span>
                    <p className="text-text bg-bg-hover mt-0.5 max-h-32 overflow-y-auto rounded p-1.5 font-mono text-[11px] wrap-break-word whitespace-pre-wrap">
                      {lastError}
                    </p>
                  </div>
                )}
                {consecutiveFailures !== undefined && (
                  <div className="flex justify-between gap-3">
                    <span className="text-text-muted">Consecutive failures</span>
                    <span className="text-danger font-semibold">{consecutiveFailures}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-text-muted">Expires at</span>
                  <span className="text-text text-right font-semibold">{expiryStr}</span>
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
};
