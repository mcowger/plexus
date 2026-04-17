import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { clsx } from 'clsx';
import { ResponsiveTable, type ResponsiveTableColumn } from './ResponsiveTable';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

export interface DataTableColumn<T> extends ResponsiveTableColumn<T> {
  sortable?: boolean;
  sortKey?: (row: T) => string | number;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  loading?: boolean;
  error?: React.ReactNode;
  emptyTitle?: React.ReactNode;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Number of rows per page. Set to 0 to disable pagination. */
  pageSize?: number;
  className?: string;
  noMobileCards?: boolean;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  loading,
  error,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  pageSize = 0,
  className,
  noMobileCards,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sortable) return data;
    const getKey = col.sortKey;
    if (!getKey) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const ka = getKey(a);
      const kb = getKey(b);
      if (ka < kb) return sort.direction === 'asc' ? -1 : 1;
      if (ka > kb) return sort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [data, sort, columns]);

  const paged = useMemo(() => {
    if (pageSize <= 0) return sortedData;
    const start = page * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;

  const handleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  if (loading && data.length === 0) {
    return (
      <div className={clsx('flex flex-col gap-2', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={48} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={clsx(
          'p-4 sm:p-6 rounded-lg border border-danger/40 bg-danger/10 text-danger font-body text-sm',
          className
        )}
      >
        {error}
      </div>
    );
  }

  const columnsWithSort: ResponsiveTableColumn<T>[] = columns.map((col) => {
    if (!col.sortable) return col;
    const isSorted = sort?.key === col.key;
    return {
      ...col,
      header: (
        <button
          type="button"
          onClick={() => handleSort(col.key)}
          className="inline-flex items-center gap-1 hover:text-text transition-colors duration-fast"
        >
          {col.header}
          {isSorted && sort?.direction === 'asc' && <ArrowUp size={12} />}
          {isSorted && sort?.direction === 'desc' && <ArrowDown size={12} />}
        </button>
      ),
    };
  });

  return (
    <div className={clsx('flex flex-col gap-4', className)}>
      <ResponsiveTable<T>
        columns={columnsWithSort}
        data={paged}
        getRowKey={getRowKey}
        onRowClick={onRowClick}
        noMobileCards={noMobileCards}
        emptyState={
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
            dense
          />
        }
      />
      {pageSize > 0 && sortedData.length > pageSize && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            Page {page + 1} of {totalPages} · {sortedData.length} items
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              leftIcon={<ChevronLeft size={14} />}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
