import { clsx } from 'clsx';
import React from 'react';

export interface ResponsiveTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T, index: number) => React.ReactNode;
  /** Column priority controls mobile visibility. `high` always shows; `low` hidden on mobile. */
  priority?: 'high' | 'medium' | 'low';
  align?: 'left' | 'center' | 'right';
  width?: string;
  /** Label shown above the value in mobile card mode. Defaults to `header`. */
  mobileLabel?: React.ReactNode;
  /** Override: show as the main title of the mobile card. */
  mobileTitle?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T, index: number) => void;
  emptyState?: React.ReactNode;
  className?: string;
  /** Disable the mobile card layout and use horizontal scroll instead. */
  noMobileCards?: boolean;
}

const alignClass: Record<NonNullable<ResponsiveTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function ResponsiveTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  emptyState,
  className,
  noMobileCards,
}: ResponsiveTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={className}>
      {/* Desktop / tablet table */}
      <div
        className={clsx(
          'border-border-glass overflow-x-auto rounded-lg border',
          noMobileCards ? 'block' : 'hidden md:block'
        )}
      >
        <table className="font-body w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bg-glass/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={clsx(
                    'text-text-muted border-border-glass border-b px-4 py-3 text-xs font-semibold tracking-wider uppercase',
                    alignClass[col.align ?? 'left'],
                    col.priority === 'low' && 'hidden lg:table-cell',
                    col.priority === 'medium' && 'hidden md:table-cell'
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr
                key={getRowKey(row, rowIdx)}
                onClick={onRowClick ? () => onRowClick(row, rowIdx) : undefined}
                className={clsx(
                  'border-border-glass/50 duration-fast border-b transition-colors last:border-b-0',
                  onRowClick && 'hover:bg-bg-hover cursor-pointer'
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      'text-text px-4 py-3',
                      alignClass[col.align ?? 'left'],
                      col.priority === 'low' && 'hidden lg:table-cell',
                      col.priority === 'medium' && 'hidden md:table-cell'
                    )}
                  >
                    {col.render(row, rowIdx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      {!noMobileCards && (
        <div className="flex flex-col gap-3 md:hidden">
          {data.map((row, rowIdx) => {
            const titleCol = columns.find((c) => c.mobileTitle);
            const detailCols = columns.filter((c) => !c.mobileTitle && c.priority !== 'low');
            return (
              <div
                key={getRowKey(row, rowIdx)}
                onClick={onRowClick ? () => onRowClick(row, rowIdx) : undefined}
                className={clsx(
                  'glass-bg border-border-glass flex flex-col gap-2 rounded-lg border p-4',
                  onRowClick &&
                    'hover:border-primary/40 duration-fast cursor-pointer transition-colors'
                )}
              >
                {titleCol && (
                  <div className="font-heading text-text text-sm font-semibold break-words">
                    {titleCol.render(row, rowIdx)}
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {detailCols.map((col) => (
                    <React.Fragment key={col.key}>
                      <dt className="text-text-muted self-center text-[10px] font-medium tracking-wider uppercase">
                        {col.mobileLabel ?? col.header}
                      </dt>
                      <dd className="text-text break-words">{col.render(row, rowIdx)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
