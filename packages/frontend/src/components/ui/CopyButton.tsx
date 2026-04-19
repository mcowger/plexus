import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { isClipboardAvailable, copyToClipboard } from '../../lib/clipboard';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
  variant?: 'icon' | 'button';
  /**
   * When true, the button is hidden completely if clipboard is unavailable.
   * When false (default), the button shows as disabled with a tooltip.
   */
  hideWhenUnavailable?: boolean;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label = 'Copy',
  size = 'md',
  className,
  variant = 'icon',
  hideWhenUnavailable = false,
}) => {
  const [copied, setCopied] = useState(false);
  const canCopy = isClipboardAvailable();

  // If clipboard is not available and hideWhenUnavailable is true, don't render
  if (!canCopy && hideWhenUnavailable) {
    return null;
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canCopy) return;

    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const iconSize = size === 'sm' ? 12 : 14;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        disabled={!canCopy}
        aria-label={copied ? 'Copied' : label}
        title={!canCopy ? 'Copy requires HTTPS connection' : copied ? 'Copied!' : label}
        className={clsx(
          'inline-flex items-center justify-center rounded-md transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2',
          size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
          !canCopy
            ? 'text-text-muted cursor-not-allowed opacity-50'
            : 'text-text-muted hover:text-text hover:bg-bg-hover cursor-pointer',
          className
        )}
      >
        {copied ? <Check size={iconSize} className="text-success" /> : <Copy size={iconSize} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!canCopy}
      title={!canCopy ? 'Copy requires HTTPS connection' : undefined}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-all duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2',
        !canCopy
          ? 'border-border-glass/30 bg-bg-glass/30 text-text-muted cursor-not-allowed opacity-50'
          : 'border-border-glass bg-bg-glass text-text-secondary hover:text-text hover:border-primary cursor-pointer',
        className
      )}
    >
      {copied ? <Check size={iconSize} className="text-success" /> : <Copy size={iconSize} />}
      {copied ? 'Copied' : label}
    </button>
  );
};
