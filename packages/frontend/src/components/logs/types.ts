import type { UsageRecord } from '../../lib/api';

export interface ProgressUpdate {
  requestId: string;
  bytesReceived: number;
  bytesPerSec: number | null;
  semanticBytesReceived?: number;
  semanticBytesPerSec?: number | null;
  isStreamed: boolean;
  state: 'DISPATCHED' | 'GRACE_PERIOD' | 'MONITORING' | 'THROUGHPUT_STALLED';
  elapsedMs: number;
}

export interface PaginationControlsProps {
  position: 'top' | 'bottom';
  currentPage: number;
  totalPages: number;
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}

export interface LogRowProps {
  log: UsageRecord;
  isNewest: boolean;
  liveNow?: number;
  progress?: ProgressUpdate;
  onError: (requestId: string) => void;
  onDebug: (requestId: string) => void;
}

export interface DesktopLogRowProps extends LogRowProps {
  onRetryDetails: (log: UsageRecord) => void;
  onDelete: (requestId: string) => void;
}
