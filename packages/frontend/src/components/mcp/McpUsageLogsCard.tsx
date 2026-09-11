import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Trash2,
  Zap,
  ZapOff,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import type { McpLogRecord } from '../../lib/api';
import { formatMs } from '../../lib/format';

export interface McpLogsFilters {
  serverName: string;
  apiKey: string;
}

interface McpUsageLogsCardProps {
  logs: McpLogRecord[];
  logsTotal: number;
  logsLoading: boolean;
  logsLimit: number;
  logsOffset: number;
  logsFilters: McpLogsFilters;
  onFiltersChange: (filters: McpLogsFilters) => void;
  onSearch: (event: React.FormEvent<HTMLFormElement>) => void;
  onDeleteAll: () => void;
  onDeleteLog: (requestId: string) => void;
  onOffsetChange: (offset: number) => void;
}

const statusColor = (status: number | null): string => {
  if (status === null) return 'text-text-secondary';
  if (status >= 200 && status < 300) return 'text-success';
  if (status >= 400 && status < 500) return 'text-warning';
  return 'text-danger';
};

export function McpUsageLogsCard({
  logs,
  logsTotal,
  logsLoading,
  logsLimit,
  logsOffset,
  logsFilters,
  onFiltersChange,
  onSearch,
  onDeleteAll,
  onDeleteLog,
  onOffsetChange,
}: McpUsageLogsCardProps) {
  const logsTotalPages = Math.ceil(logsTotal / logsLimit);
  const logsCurrentPage = Math.floor(logsOffset / logsLimit) + 1;

  return (
    <Card className="glass-bg rounded-lg p-3 max-w-full shadow-xl overflow-hidden flex flex-col gap-2">
      <div className="mb-2">
        <h2 className="font-heading text-lg font-semibold text-text m-0 mb-3">MCP Usage Logs</h2>
        <form onSubmit={onSearch} className="flex flex-col gap-2 lg:flex-row lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative w-full sm:w-50">
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-secondary)',
                }}
              />
              <Input
                placeholder="Filter by Server..."
                value={logsFilters.serverName}
                onChange={(e) => onFiltersChange({ ...logsFilters, serverName: e.target.value })}
                style={{ paddingLeft: '32px' }}
              />
            </div>
            <div className="relative w-full sm:w-44">
              <Filter
                size={16}
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-secondary)',
                }}
              />
              <Input
                placeholder="Filter by Key..."
                value={logsFilters.apiKey}
                onChange={(e) => onFiltersChange({ ...logsFilters, apiKey: e.target.value })}
                style={{ paddingLeft: '32px' }}
              />
            </div>
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              Search
            </Button>
          </div>
          <Button
            onClick={onDeleteAll}
            variant="danger"
            className="flex w-full items-center gap-2 sm:w-auto"
            disabled={logs.length === 0}
            type="button"
          >
            <Trash2 size={16} />
            Delete All
          </Button>
        </form>
      </div>

      <div className="space-y-3 lg:hidden">
        {logsLoading ? (
          <div className="py-8 text-center text-sm text-text-secondary">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-secondary">No MCP logs found</div>
        ) : (
          logs.map((log) => (
            <article
              key={log.request_id}
              className="rounded-md border border-border-glass bg-bg-subtle p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-text">
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                  <div className="mt-1 truncate text-xs text-text-muted">
                    {log.api_key || '-'} {log.attribution ? `(${log.attribution})` : ''}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDeleteLog(log.request_id)}
                  className="text-danger"
                  aria-label="Delete MCP log"
                >
                  <Trash2 size={14} />
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Server</div>
                  <div className="truncate font-medium text-text-secondary">{log.server_name}</div>
                </div>
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">Method</div>
                  <div className="truncate font-medium text-text-secondary">
                    {log.method} {log.is_streamed ? 'streamed' : 'buffered'}
                  </div>
                </div>
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">RPC</div>
                  <div className="truncate font-mono text-text">{log.jsonrpc_method || '-'}</div>
                </div>
                <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-text-muted">
                    Duration
                  </div>
                  <div className="truncate font-medium text-text">
                    {log.duration_ms != null ? formatMs(log.duration_ms) : '-'}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 rounded border border-border-glass bg-bg-glass px-2 py-2 text-xs">
                <span className={clsx('font-semibold', statusColor(log.response_status))}>
                  Status {log.response_status ?? '?'}
                </span>
                {log.error_message && (
                  <span className="min-w-0 truncate text-danger" title={log.error_message}>
                    {log.error_message}
                  </span>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse font-body text-[13px]">
          <thead>
            <tr className="text-center border-b border-border">
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Date
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Key
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Server
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Method
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                RPC Method
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Duration
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                Status
              </th>
              <th className="px-2 py-1.5 text-center border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                <div className="flex justify-center">
                  <Trash2 size={12} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {logsLoading ? (
              <tr>
                <td colSpan={8} className="p-5 text-center">
                  Loading...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-5 text-center text-text-secondary">
                  No MCP logs found
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.request_id}
                  className="group border-b border-border-glass hover:bg-bg-hover"
                >
                  {/* Date */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                      <span className="text-text-secondary" style={{ fontSize: '0.85em' }}>
                        {new Date(log.created_at).toISOString().split('T')[0]}
                      </span>
                    </div>
                  </td>

                  {/* Key / Attribution */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                    <div className="flex flex-col">
                      <span className="font-medium">{log.api_key || '-'}</span>
                      {log.attribution && (
                        <span className="text-text-secondary" style={{ fontSize: '0.85em' }}>
                          {log.attribution}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Server */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-medium">{log.server_name}</span>
                      <span
                        className="text-text-secondary"
                        style={{
                          fontSize: '0.85em',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {log.upstream_url}
                      </span>
                    </div>
                  </td>

                  {/* HTTP Method */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <span
                        className={clsx(
                          'text-xs font-semibold',
                          log.method === 'GET'
                            ? 'text-blue-400'
                            : log.method === 'POST'
                              ? 'text-green-400'
                              : 'text-red-400'
                        )}
                      >
                        {log.method}
                      </span>
                      <div className="flex items-center gap-1">
                        {log.is_streamed ? (
                          <Zap size={11} className="text-blue-400" />
                        ) : (
                          <ZapOff size={11} className="text-gray-400" />
                        )}
                        <span className="text-text-secondary" style={{ fontSize: '0.8em' }}>
                          {log.is_streamed ? 'streamed' : 'buffered'}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* JSON-RPC Method + Tool Name */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs">
                        {log.jsonrpc_method || <span className="text-text-secondary">-</span>}
                      </span>
                      {log.tool_name && (
                        <span className="font-mono text-xs text-info" title={log.tool_name}>
                          {log.tool_name}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Duration */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                    <span>{log.duration_ms != null ? formatMs(log.duration_ms) : '-'}</span>
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                    <div className="flex flex-col gap-1">
                      {log.error_code ? (
                        <div
                          className={clsx(
                            'inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium border',
                            'text-danger border-danger/30 bg-red-500/15'
                          )}
                          style={{ width: '52px' }}
                        >
                          <AlertTriangle size={12} />
                          <span className="font-semibold">{log.response_status ?? '?'}</span>
                        </div>
                      ) : (
                        <div
                          className={clsx(
                            'inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium border',
                            log.response_status != null &&
                              log.response_status >= 200 &&
                              log.response_status < 300
                              ? 'text-success border-success/30 bg-emerald-500/15'
                              : 'text-danger border-danger/30 bg-red-500/15'
                          )}
                          style={{ width: '52px' }}
                        >
                          <CheckCircle size={12} />
                          <span className={clsx('font-semibold', statusColor(log.response_status))}>
                            {log.response_status ?? '?'}
                          </span>
                        </div>
                      )}
                      {log.error_message && (
                        <span
                          className="text-danger"
                          style={{
                            fontSize: '0.78em',
                            maxWidth: '160px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'block',
                          }}
                          title={log.error_message}
                        >
                          {log.error_message}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Delete */}
                  <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                    <button
                      onClick={() => onDeleteLog(log.request_id)}
                      className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                      title="Delete log"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col items-stretch gap-3 mt-3 sm:flex-row sm:items-center sm:justify-end">
        <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
          Page {logsCurrentPage} of {Math.max(1, logsTotalPages)}
        </span>
        <div className="flex gap-1">
          <Button
            variant="secondary"
            disabled={logsOffset === 0}
            onClick={() => onOffsetChange(Math.max(0, logsOffset - logsLimit))}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="secondary"
            disabled={logsOffset + logsLimit >= logsTotal}
            onClick={() => onOffsetChange(logsOffset + logsLimit)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </Card>
  );
}
