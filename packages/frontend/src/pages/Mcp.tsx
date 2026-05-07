import { useEffect, useState, useRef } from 'react';
import { api, McpServer, McpLogRecord } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useToast } from '../contexts/ToastContext';
import {
  Plus,
  Trash2,
  Edit2,
  PlusCircle,
  MinusCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle,
  Zap,
  ZapOff,
} from 'lucide-react';
import { Switch } from '../components/ui/Switch';
import { clsx } from 'clsx';
import { formatMs } from '../lib/format';

const EMPTY_SERVER: McpServer = {
  upstream_url: '',
  enabled: true,
  headers: {},
};

export const McpPage: React.FC = () => {
  const toast = useToast();
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [serverNameInput, setServerNameInput] = useState('');
  const [editingServer, setEditingServer] = useState<McpServer>(EMPTY_SERVER);
  const [isSaving, setIsSaving] = useState(false);
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');

  // Logs state
  const [logs, setLogs] = useState<McpLogRecord[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLimit] = useState(20);
  const [logsOffset, setLogsOffset] = useState(0);
  const [logsFilters, setLogsFilters] = useState({ serverName: '', apiKey: '' });

  // Delete logs modal state
  const [isDeleteLogsModalOpen, setIsDeleteLogsModalOpen] = useState(false);
  const [deleteLogsMode, setDeleteLogsMode] = useState<'all' | 'older'>('older');
  const [olderThanDays, setOlderThanDays] = useState(7);
  const [isDeletingLogs, setIsDeletingLogs] = useState(false);

  // Single log delete state
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);

  const logsFiltersRef = useRef(logsFilters);
  useEffect(() => {
    logsFiltersRef.current = logsFilters;
  }, [logsFilters]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [logsOffset]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const data = await api.getMcpServers();
      setServers(data);
    } catch (e) {
      console.error('Failed to load MCP servers', e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const filters: { serverName?: string; apiKey?: string } = {};
      if (logsFilters.serverName) filters.serverName = logsFilters.serverName;
      if (logsFilters.apiKey) filters.apiKey = logsFilters.apiKey;
      const res = await api.getMcpLogs(logsLimit, logsOffset, filters);
      setLogs(res.data);
      setLogsTotal(Number(res.total) || 0);
    } catch (e) {
      console.error('Failed to load MCP logs', e);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleLogSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLogsOffset(0);
    loadLogs();
  };

  const handleDeleteAllLogs = () => {
    setIsDeleteLogsModalOpen(true);
  };

  const confirmDeleteAllLogs = async () => {
    setIsDeletingLogs(true);
    try {
      if (deleteLogsMode === 'all') {
        await api.deleteAllMcpLogs();
      } else {
        await api.deleteAllMcpLogs(olderThanDays);
      }
      setLogsOffset(0);
      await loadLogs();
      setIsDeleteLogsModalOpen(false);
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const handleDeleteLog = (requestId: string) => {
    setSelectedLogId(requestId);
    setIsSingleDeleteModalOpen(true);
  };

  const confirmDeleteSingleLog = async () => {
    if (!selectedLogId) return;
    setIsDeletingLogs(true);
    try {
      await api.deleteMcpLog(selectedLogId);
      setLogs(logs.filter((l) => l.request_id !== selectedLogId));
      setLogsTotal((prev) => Math.max(0, prev - 1));
      setIsSingleDeleteModalOpen(false);
      setSelectedLogId(null);
    } catch (e) {
      console.error('Failed to delete MCP log', e);
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const handleAddNew = () => {
    setEditingServerName(null);
    setServerNameInput('');
    setEditingServer({ ...EMPTY_SERVER });
    setHeaderKey('');
    setHeaderValue('');
    setIsModalOpen(true);
  };

  const handleEdit = (serverName: string) => {
    const server = servers[serverName];
    if (!server) return;
    setEditingServerName(serverName);
    setServerNameInput(serverName);
    setEditingServer({ ...server });
    setHeaderKey('');
    setHeaderValue('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    const nameToSave = editingServerName || serverNameInput;
    if (!nameToSave || !nameToSave.trim()) {
      toast.error('Server Name is required');
      return;
    }
    if (!editingServerName && !isValidServerName(nameToSave)) {
      toast.error(
        'Invalid server name. Use lowercase letters, numbers, hyphens, and underscores (2-63 characters, must start with letter or number)'
      );
      return;
    }
    if (!editingServer.upstream_url || !editingServer.upstream_url.trim()) {
      toast.error('Upstream URL is required');
      return;
    }

    // Auto-commit any pending header entry that hasn't been added via the + button
    const finalHeaders = { ...editingServer.headers };
    if (headerKey.trim() && headerValue.trim()) {
      finalHeaders[headerKey.trim()] = headerValue.trim();
    }

    setIsSaving(true);
    try {
      await api.saveMcpServer(nameToSave, {
        upstream_url: editingServer.upstream_url,
        enabled: editingServer.enabled,
        headers: finalHeaders,
      });
      await loadData();
      setIsModalOpen(false);
    } catch (e) {
      console.error('Save error', e);
      toast.error(`Failed to save MCP server: ${e}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (serverName: string) => {
    const ok = await toast.confirm({
      title: 'Delete MCP server?',
      message: `Are you sure you want to delete the MCP server "${serverName}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteMcpServer(serverName);
      await loadData();
      toast.success(`Deleted ${serverName}`);
    } catch (e) {
      console.error('Delete error', e);
      toast.error(`Failed to delete MCP server: ${e}`);
    }
  };

  const handleToggleEnabled = async (serverName: string, newState: boolean) => {
    const server = servers[serverName];
    if (!server) return;

    try {
      await api.saveMcpServer(serverName, {
        ...server,
        enabled: newState,
      });
      await loadData();
    } catch (e) {
      console.error('Toggle error', e);
      toast.error(`Failed to update MCP server: ${e}`);
    }
  };

  const isValidServerName = (name: string): boolean => {
    return /^[a-z0-9][a-z0-9-_]{1,62}$/.test(name);
  };

  const addHeader = () => {
    if (!headerKey.trim() || !headerValue.trim()) return;
    setEditingServer({
      ...editingServer,
      headers: {
        ...editingServer.headers,
        [headerKey.trim()]: headerValue.trim(),
      },
    });
    setHeaderKey('');
    setHeaderValue('');
  };

  const removeHeader = (key: string) => {
    const newHeaders = { ...editingServer.headers };
    delete newHeaders[key];
    setEditingServer({
      ...editingServer,
      headers: newHeaders,
    });
  };

  const serverNames = Object.keys(servers);
  const logsTotalPages = Math.ceil(logsTotal / logsLimit);
  const logsCurrentPage = Math.floor(logsOffset / logsLimit) + 1;

  const statusColor = (status: number | null): string => {
    if (status === null) return 'text-text-secondary';
    if (status >= 200 && status < 300) return 'text-success';
    if (status >= 400 && status < 500) return 'text-warning';
    return 'text-danger';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
        <Card title="MCP Servers">
          <div className="p-4 text-text-secondary">Loading...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="MCP servers"
        subtitle="Model Context Protocol connections — exposes tools and resources to clients"
        actions={
          <Button leftIcon={<Plus size={14} />} onClick={handleAddNew} size="sm">
            Add server
          </Button>
        }
      />
      <PageContainer>
        <div className="flex flex-col gap-5">
          {/* Servers Config Card */}
          <Card title="MCP Servers">
            {serverNames.length === 0 ? (
              <div className="p-4 text-text-secondary text-center">
                No MCP servers configured. Click "Add MCP Server" to create one.
              </div>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {serverNames.map((name) => {
                    const server = servers[name];
                    const headerCount = server.headers ? Object.keys(server.headers).length : 0;

                    return (
                      <article
                        key={name}
                        className="rounded-md border border-border-glass bg-bg-subtle p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => handleEdit(name)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <Edit2 size={12} className="shrink-0 opacity-60" />
                              <span className="truncate font-heading text-sm font-semibold text-text">
                                {name}
                              </span>
                            </div>
                            <div className="mt-1 break-all text-xs text-text-muted">
                              {server.upstream_url}
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            <Switch
                              checked={server.enabled !== false}
                              onChange={(val) => handleToggleEnabled(name, val)}
                              size="sm"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDelete(name)}
                              className="text-danger"
                              aria-label={`Delete ${name}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 rounded border border-border-glass bg-bg-glass px-2 py-1.5 text-xs">
                          <span className="text-text-muted">Headers: </span>
                          <span className="font-medium text-text-secondary">
                            {headerCount > 0 ? `${headerCount} configured` : '-'}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse font-body text-[13px]">
                    <thead>
                      <tr>
                        <th
                          className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                          style={{ paddingLeft: '24px' }}
                        >
                          Name
                        </th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                          Upstream URL
                        </th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                          Headers
                        </th>
                        <th
                          className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                          style={{ paddingRight: '24px', textAlign: 'right' }}
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {serverNames.map((name) => {
                        const server = servers[name];
                        const headerCount = server.headers ? Object.keys(server.headers).length : 0;
                        return (
                          <tr
                            key={name}
                            onClick={() => handleEdit(name)}
                            style={{ cursor: 'pointer' }}
                            className="hover:bg-bg-hover"
                          >
                            <td
                              className="px-4 py-3 text-left border-b border-border-glass text-text"
                              style={{ paddingLeft: '24px' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Edit2 size={12} style={{ opacity: 0.5 }} />
                                <div style={{ fontWeight: 600 }}>{name}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                              <div
                                style={{
                                  maxWidth: '400px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {server.upstream_url}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                              <div onClick={(e) => e.stopPropagation()}>
                                <Switch
                                  checked={server.enabled !== false}
                                  onChange={(val) => handleToggleEnabled(name, val)}
                                  size="sm"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                              {headerCount > 0 ? `${headerCount} header(s)` : '-'}
                            </td>
                            <td
                              className="px-4 py-3 text-left border-b border-border-glass text-text"
                              style={{ paddingRight: '24px', textAlign: 'right' }}
                            >
                              <div
                                style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}
                              >
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(name);
                                  }}
                                  style={{ color: 'var(--color-danger)' }}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          {/* ── Usage Logs Card ── */}
          <Card className="glass-bg rounded-lg p-3 max-w-full shadow-xl overflow-hidden flex flex-col gap-2">
            <div className="mb-2">
              <h2 className="font-heading text-lg font-semibold text-text m-0 mb-3">
                MCP Usage Logs
              </h2>
              <form
                onSubmit={handleLogSearch}
                className="flex flex-col gap-2 lg:flex-row lg:justify-between"
              >
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
                      onChange={(e) =>
                        setLogsFilters({ ...logsFilters, serverName: e.target.value })
                      }
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
                      onChange={(e) => setLogsFilters({ ...logsFilters, apiKey: e.target.value })}
                      style={{ paddingLeft: '32px' }}
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full sm:w-auto">
                    Search
                  </Button>
                </div>
                <Button
                  onClick={handleDeleteAllLogs}
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
                <div className="py-8 text-center text-sm text-text-secondary">
                  No MCP logs found
                </div>
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
                        onClick={() => handleDeleteLog(log.request_id)}
                        className="text-danger"
                        aria-label="Delete MCP log"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-text-muted">
                          Server
                        </div>
                        <div className="truncate font-medium text-text-secondary">
                          {log.server_name}
                        </div>
                      </div>
                      <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-text-muted">
                          Method
                        </div>
                        <div className="truncate font-medium text-text-secondary">
                          {log.method} {log.is_streamed ? 'streamed' : 'buffered'}
                        </div>
                      </div>
                      <div className="min-w-0 rounded border border-border-glass bg-bg-glass px-2 py-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-text-muted">
                          RPC
                        </div>
                        <div className="truncate font-mono text-text">
                          {log.jsonrpc_method || '-'}
                        </div>
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
                                <span
                                  className={clsx(
                                    'font-semibold',
                                    statusColor(log.response_status)
                                  )}
                                >
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
                            onClick={() => handleDeleteLog(log.request_id)}
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
                  onClick={() => setLogsOffset(Math.max(0, logsOffset - logsLimit))}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  variant="secondary"
                  disabled={logsOffset + logsLimit >= logsTotal}
                  onClick={() => setLogsOffset(logsOffset + logsLimit)}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </Card>

          {/* ── Server Edit/Add Modal ── */}
          <Modal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title={editingServerName ? `Edit ${editingServerName}` : 'Add MCP Server'}
            footer={
              <>
                <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              {!editingServerName && (
                <Input
                  label="Server Name"
                  value={serverNameInput}
                  onChange={(e) =>
                    setServerNameInput(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))
                  }
                  placeholder="my-mcp-server"
                />
              )}

              <Input
                label="Upstream URL"
                value={editingServer.upstream_url}
                onChange={(e) =>
                  setEditingServer({ ...editingServer, upstream_url: e.target.value })
                }
                placeholder="https://mcp.example.com/mcp"
              />

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Header Key"
                    value={headerKey}
                    onChange={(e) => setHeaderKey(e.target.value)}
                    placeholder="Authorization"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Input
                    label="Header Value"
                    value={headerValue}
                    onChange={(e) => setHeaderValue(e.target.value)}
                    placeholder="Bearer token..."
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addHeader}
                  className="w-full sm:w-auto"
                >
                  <PlusCircle size={16} />
                </Button>
              </div>

              {editingServer.headers && Object.keys(editingServer.headers).length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-secondary">
                    Configured Headers
                  </label>
                  {Object.entries(editingServer.headers).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-2 p-2 bg-bg-hover rounded-md sm:flex-row sm:items-center"
                    >
                      <span className="min-w-0 flex-1 break-all font-mono text-xs">{key}</span>
                      <span className="flex-1 font-mono text-xs text-text-secondary truncate">
                        {value}
                      </span>
                      <button
                        onClick={() => removeHeader(key)}
                        className="p-1 hover:bg-bg-surface rounded"
                      >
                        <MinusCircle size={14} className="text-danger" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Modal>

          {/* ── Delete All Logs Modal ── */}
          <Modal
            isOpen={isDeleteLogsModalOpen}
            onClose={() => setIsDeleteLogsModalOpen(false)}
            title="Confirm Deletion"
            footer={
              <>
                <Button variant="secondary" onClick={() => setIsDeleteLogsModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDeleteAllLogs} disabled={isDeletingLogs}>
                  {isDeletingLogs ? 'Deleting...' : 'Delete Logs'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <p>Select which MCP logs you would like to delete:</p>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  id="mcp-delete-older"
                  name="deleteLogsMode"
                  checked={deleteLogsMode === 'older'}
                  onChange={() => setDeleteLogsMode('older')}
                />
                <label htmlFor="mcp-delete-older">Delete logs older than</label>
                <Input
                  type="number"
                  min="1"
                  value={olderThanDays}
                  onChange={(e) => setOlderThanDays(parseInt(e.target.value) || 1)}
                  style={{ width: '60px', padding: '4px 8px' }}
                  disabled={deleteLogsMode !== 'older'}
                />
                <span>days</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="mcp-delete-all"
                  name="deleteLogsMode"
                  checked={deleteLogsMode === 'all'}
                  onChange={() => setDeleteLogsMode('all')}
                />
                <label htmlFor="mcp-delete-all" style={{ color: 'var(--color-danger)' }}>
                  Delete ALL logs (Cannot be undone)
                </label>
              </div>
            </div>
          </Modal>

          {/* ── Single Log Delete Modal ── */}
          <Modal
            isOpen={isSingleDeleteModalOpen}
            onClose={() => setIsSingleDeleteModalOpen(false)}
            title="Confirm Deletion"
            footer={
              <>
                <Button variant="secondary" onClick={() => setIsSingleDeleteModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDeleteSingleLog} disabled={isDeletingLogs}>
                  {isDeletingLogs ? 'Deleting...' : 'Delete Log'}
                </Button>
              </>
            }
          >
            <p>Are you sure you want to delete this MCP log entry?</p>
          </Modal>
        </div>
      </PageContainer>
    </div>
  );
};

export default McpPage;
