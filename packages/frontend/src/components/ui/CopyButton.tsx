import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
  variant?: 'icon' | 'button';
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  label = 'Copy',
  size = 'md',
  className,
  variant = 'icon',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const iconSize = size === 'sm' ? 12 : 14;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : label}
        className={clsx(
          'inline-flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2',
          size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
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
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border border-border-glass bg-bg-glass px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text hover:border-primary transition-all duration-fast focus-visible:outline-2 focus-visible:outline focus-visible:outline-primary focus-visible:outline-offset-2',
        className
      )}
    >
      {copied ? <Check size={iconSize} className="text-success" /> : <Copy size={iconSize} />}
      {copied ? 'Copied' : label}
    </button>
  );
};
