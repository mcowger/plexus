import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import type { PaginationControlsProps } from './types';

export const PaginationControls = ({
  position,
  currentPage,
  totalPages,
  offset,
  limit,
  total,
  onOffsetChange,
}: PaginationControlsProps) => (
  <div
    className={clsx(
      'flex items-center justify-between gap-2 px-2 py-2 sm:justify-end sm:gap-3 sm:px-3 sm:py-3',
      position === 'top' ? 'border-b border-border' : 'border-t border-border'
    )}
  >
    <span className="text-xs text-text-secondary font-mono">
      Page {currentPage} of {Math.max(1, totalPages)}
    </span>
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - limit))}
      >
        <ChevronLeft size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={offset + limit >= total}
        onClick={() => onOffsetChange(offset + limit)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  </div>
);
