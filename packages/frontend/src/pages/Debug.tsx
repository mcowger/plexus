import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import Editor from '@monaco-editor/react';
import {
  RefreshCw,
  Clock,
  Database,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Download,
  Filter,
  X,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/layout/PageHeader';
import { useLocation } from 'react-router-dom';
import type { Alias, KeyConfig, Provider } from '../lib/api';
import { isClipboardAvailable, copyToClipboard } from '../lib/clipboard';
import { useAuth } from '../contexts/AuthContext';

interface DebugLogMeta {
  requestId: string;
  createdAt: number;
  responseStatus?: number | null;
}

interface DebugLogDetail extends DebugLogMeta {
  rawRequest: string | object;
  transformedRequest: string | object;
  rawResponse: string | object;
  transformedResponse: string | object;
  rawResponseSnapshot?: string | object;
  transformedResponseSnapshot?: string | object;
  requestHeaders?: string | object;
  responseHeaders?: string | object;
}

export const Debug: React.FC = () => {
  const location = useLocation();
  const { isAdmin, principal } = useAuth();
  const [logs, setLogs] = useState<DebugLogMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DebugLogDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  // Debug capture target state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keys, setKeys] = useState<KeyConfig[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [captureTraceOnError, setCaptureTraceOnError] = useState(false);
  const [captureTraceLoaded, setCaptureTraceLoaded] = useState(false);
  const [captureTraceSaving, setCaptureTraceSaving] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedAliases, setSelectedAliases] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Delete Modal State
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);
  const [selectedLogIdForDelete, setSelectedLogIdForDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (location.state?.requestId) {
      setSelectedId(location.state.requestId);
      // clear state so it doesn't persist on refresh if we wanted, but standard behavior is fine
    }
  }, [location.state]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getDebugLogs(50);
      setLogs(data);
      if (data.length > 0 && !selectedId && !location.state?.requestId) {
        // Optionally select first? No, let user choose.
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAll = () => {
    setIsDeleteAllModalOpen(true);
  };

  const confirmDeleteAll = async () => {
    setIsDeleting(true);
    try {
      await api.deleteAllDebugLogs();
      await fetchLogs();
      setSelectedId(null);
      setDetail(null);
      setIsDeleteAllModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, requestId: string) => {
    e.stopPropagation();
    setSelectedLogIdForDelete(requestId);
    setIsSingleDeleteModalOpen(true);
  };

  const confirmDeleteSingle = async () => {
    if (!selectedLogIdForDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteDebugLog(selectedLogIdForDelete);
      setLogs(logs.filter((l) => l.requestId !== selectedLogIdForDelete));
      if (selectedId === selectedLogIdForDelete) {
        setSelectedId(null);
        setDetail(null);
      }
      setIsSingleDeleteModalOpen(false);
      setSelectedLogIdForDelete(null);
    } catch (e) {
      console.error('Failed to delete log', e);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // Auto-refresh list
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedId) {
      setLoadingDetail(true);
      api.getDebugLogDetail(selectedId).then((data) => {
        setDetail(data);
        setLoadingDetail(false);
      });
    } else {
      setDetail(null);
    }
  }, [selectedId]);

  useEffect(() => {
    setCopiedAll(false);
  }, [detail?.requestId]);

  // Fetch capture dimensions and debug status
  useEffect(() => {
    const fetchProvidersAndStatus = async () => {
      try {
        const [providersData, keysData, aliasesData, debugStatus] = await Promise.all([
          api.getProviders(),
          isAdmin ? api.getKeys() : Promise.resolve([]),
          isAdmin ? api.getAliases() : Promise.resolve([]),
          api.getDebugMode(),
        ]);
        setProviders(providersData);
        setKeys(keysData);
        setAliases(aliasesData);
        setDebugEnabled(debugStatus.enabled);
        setSelectedProviders(debugStatus.providers || []);
        setSelectedKeys(debugStatus.keys || debugStatus.enabledKeys || []);
        setSelectedAliases(debugStatus.aliases || []);
      } catch (e) {
        console.error('Failed to fetch capture targets or debug status', e);
      }
      // Capture-trace-on-error is an admin-only persisted setting.
      if (isAdmin) {
        try {
          const { enabled } = await api.getCaptureTraceOnError();
          setCaptureTraceOnError(enabled);
          setCaptureTraceLoaded(true);
        } catch (e) {
          console.error('Failed to fetch capture-trace-on-error setting', e);
        }
      }
    };
    fetchProvidersAndStatus();
  }, [isAdmin]);

  const handleToggleCaptureTraceOnError = async (checked: boolean) => {
    const previous = captureTraceOnError;
    setCaptureTraceOnError(checked);
    setCaptureTraceSaving(true);
    try {
      const { enabled } = await api.setCaptureTraceOnError(checked);
      setCaptureTraceOnError(enabled);
    } catch (e) {
      setCaptureTraceOnError(previous);
      console.error('Failed to update capture-trace-on-error setting', e);
    } finally {
      setCaptureTraceSaving(false);
    }
  };

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.provider-filter-dropdown')) {
        setIsFilterOpen(false);
      }
    };

    if (isFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isFilterOpen]);

  const toggleSelection = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]
    );
  };

  const applyCaptureTargets = async () => {
    try {
      const next = await api.setDebugMode(
        debugEnabled,
        selectedProviders.length > 0 ? selectedProviders : null,
        selectedKeys.length > 0 ? selectedKeys : null,
        selectedAliases.length > 0 ? selectedAliases : null
      );
      setDebugEnabled(next.enabledGlobal ?? next.enabled);
      setSelectedProviders(next.providers || []);
      setSelectedKeys(next.keys || next.enabledKeys || []);
      setSelectedAliases(next.aliases || []);
      setIsFilterOpen(false);
    } catch (e) {
      console.error('Failed to apply capture targets', e);
    }
  };

  const clearCaptureTargets = async () => {
    try {
      const next = await api.setDebugMode(debugEnabled, null, null, null);
      setSelectedProviders(next.providers || []);
      setSelectedKeys(next.keys || next.enabledKeys || []);
      setSelectedAliases(next.aliases || []);
    } catch (e) {
      console.error('Failed to apply capture targets', e);
    }
  };

  const selectedCaptureTargetCount =
    selectedProviders.length + selectedKeys.length + selectedAliases.length;

  const formatContent = (content: any) => {
    if (!content) return '';
    if (typeof content === 'string') {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return JSON.stringify(content, null, 2);
  };

  const normalizeExportContent = (content: string | object | null | undefined) => {
    if (content === undefined) return undefined;
    if (content === null) return null;
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
    return content;
  };

  const getHttpStatusBadgeClasses = (status?: number | null) => {
    if (status == null) {
      return 'border-border-glass bg-bg-glass text-text-muted';
    }
    if (status >= 100 && status < 200) {
      return 'border-border-glass bg-bg-glass text-text-muted';
    }
    if (status >= 200 && status < 300) {
      return 'border-success/30 bg-emerald-500/15 text-success';
    }
    if (status >= 300 && status < 400) {
      return 'border-blue-400/30 bg-blue-500/15 text-blue-400';
    }
    if (status >= 400 && status < 500) {
      return 'border-warning/30 bg-yellow-500/15 text-warning';
    }
    return 'border-danger/30 bg-red-500/15 text-danger';
  };

  const exportContent = useMemo(() => {
    if (!detail) return '';
    const payload = {
      requestId: detail.requestId,
      createdAt: detail.createdAt,
      rawRequest: normalizeExportContent(detail.rawRequest),
      transformedRequest: normalizeExportContent(detail.transformedRequest),
      rawResponse: normalizeExportContent(detail.rawResponse),
      rawResponseSnapshot: normalizeExportContent(detail.rawResponseSnapshot),
      transformedResponse: normalizeExportContent(detail.transformedResponse),
      transformedResponseSnapshot: normalizeExportContent(detail.transformedResponseSnapshot),
      requestHeaders: normalizeExportContent(detail.requestHeaders),
      responseHeaders: normalizeExportContent(detail.responseHeaders),
      httpStatusCode: detail.responseStatus ?? null,
    };
    return JSON.stringify(payload, null, 2);
  }, [detail]);

  const handleCopyAll = async () => {
    if (!exportContent || !isClipboardAvailable()) return;
    const success = await copyToClipboard(exportContent);
    if (success) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const handleDownloadAll = () => {
    if (!detail || !exportContent) return;
    const blob = new Blob([exportContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date(detail.createdAt).toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `debug-trace-${detail.requestId}-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-3rem)]">
      <div className="shrink-0">
        <PageHeader
          title="Traces"
          subtitle={
            principal?.role === 'limited' && principal.keyName
              ? `Traces for key "${principal.keyName}" only. Toggle capture in My Key.`
              : 'Distributed spans · OTLP'
          }
          actions={
            <>
              {/* Capture-trace-on-error — admin-only persisted setting. */}
              {isAdmin && (
                <label className="flex items-center gap-2 text-sm text-text-muted">
                  <span className="hidden sm:inline">Capture on Error</span>
                  <Switch
                    checked={captureTraceOnError}
                    onChange={handleToggleCaptureTraceOnError}
                    disabled={!captureTraceLoaded || captureTraceSaving}
                    aria-label="Toggle capture trace on error"
                  />
                </label>
              )}
              {/* Capture targets — admin-only, in-memory DebugManager state. */}
              {isAdmin && (
                <div className="relative provider-filter-dropdown">
                  <Button
                    variant="secondary"
                    className={clsx(
                      'flex items-center gap-2',
                      selectedCaptureTargetCount > 0 && 'border-primary'
                    )}
                    onClick={() => setIsFilterOpen(!isFilterOpen)}
                    leftIcon={<Filter size={14} />}
                  >
                    Targets
                    {selectedCaptureTargetCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-white rounded-full">
                        {selectedCaptureTargetCount}
                      </span>
                    )}
                  </Button>

                  {isFilterOpen && (
                    <div className="absolute left-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[34rem] rounded-lg border border-border-glass bg-bg-surface p-4 shadow-lg sm:left-auto sm:right-0">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-text">Trace Capture Targets</span>
                        {selectedCaptureTargetCount > 0 && (
                          <button
                            onClick={clearCaptureTargets}
                            className="text-xs text-text-muted hover:text-text transition-colors flex items-center gap-1"
                          >
                            <X size={12} />
                            Clear
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mb-3">
                        Capture traces when any selected key, alias, provider, or global mode
                        matches.
                      </p>
                      <div className="grid max-h-80 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-3">
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase text-text-muted">
                            Keys
                          </div>
                          <div className="space-y-1">
                            {keys.length === 0 ? (
                              <div className="p-2 text-xs text-text-muted">No keys</div>
                            ) : (
                              keys.map((key) => (
                                <label
                                  key={key.key}
                                  className="flex items-center gap-2 rounded p-2 hover:bg-bg-hover cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedKeys.includes(key.key)}
                                    onChange={() => toggleSelection(key.key, setSelectedKeys)}
                                    className="rounded border-border-glass text-primary focus:ring-primary"
                                  />
                                  <span className="min-w-0 truncate text-sm text-text">
                                    {key.key}
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase text-text-muted">
                            Aliases
                          </div>
                          <div className="space-y-1">
                            {aliases.length === 0 ? (
                              <div className="p-2 text-xs text-text-muted">No aliases</div>
                            ) : (
                              aliases.map((alias) => (
                                <label
                                  key={alias.id}
                                  className="flex items-center gap-2 rounded p-2 hover:bg-bg-hover cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedAliases.includes(alias.id)}
                                    onChange={() => toggleSelection(alias.id, setSelectedAliases)}
                                    className="rounded border-border-glass text-primary focus:ring-primary"
                                  />
                                  <span className="min-w-0 truncate text-sm text-text">
                                    {alias.id}
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase text-text-muted">
                            Providers
                          </div>
                          <div className="space-y-1">
                            {providers.length === 0 ? (
                              <div className="p-2 text-xs text-text-muted">No providers</div>
                            ) : (
                              providers.map((provider) => (
                                <label
                                  key={provider.id}
                                  className="flex items-center gap-2 rounded p-2 hover:bg-bg-hover cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedProviders.includes(provider.id)}
                                    onChange={() =>
                                      toggleSelection(provider.id, setSelectedProviders)
                                    }
                                    className="rounded border-border-glass text-primary focus:ring-primary"
                                  />
                                  <span className="min-w-0 truncate text-sm text-text">
                                    {provider.name || provider.id}
                                  </span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4 pt-3 border-t border-border-glass">
                        <Button
                          variant="secondary"
                          className="flex-1 text-xs"
                          onClick={() => setIsFilterOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          className="flex-1 text-xs"
                          onClick={applyCaptureTargets}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {detail && (
                <>
                  <Button
                    variant="secondary"
                    className="flex items-center gap-2"
                    onClick={handleCopyAll}
                    leftIcon={
                      copiedAll ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} />
                      )
                    }
                  >
                    {copiedAll ? 'Copied' : 'Copy All'}
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex items-center gap-2"
                    onClick={handleDownloadAll}
                    leftIcon={<Download size={14} />}
                  >
                    Download
                  </Button>
                </>
              )}
              {isAdmin && (
                <Button
                  onClick={handleDeleteAll}
                  variant="danger"
                  className="flex items-center gap-2"
                  disabled={logs.length === 0}
                >
                  <Trash2 size={16} />
                  Delete All
                </Button>
              )}
              <Button
                onClick={fetchLogs}
                variant="secondary"
                leftIcon={<RefreshCw size={16} className={clsx(loading && 'animate-spin')} />}
              >
                Refresh
              </Button>
            </>
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border-glass md:flex-row">
        {/* Left Pane: Request List */}
        <div className="flex max-h-[34vh] w-full shrink-0 flex-col border-b border-border-glass bg-bg-surface md:max-h-none md:w-[320px] md:border-b-0 md:border-r">
          <div className="border-b border-border-glass p-3 sm:p-4">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Recent Requests
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {logs.map((log) => (
              <div
                key={log.requestId}
                onClick={() => setSelectedId(log.requestId)}
                className={clsx(
                  'p-3 rounded-md cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover group',
                  selectedId === log.requestId && 'bg-bg-glass border-border-glass shadow-sm'
                )}
              >
                <div className="w-full">
                  <div className="flex items-center gap-2 mb-1 justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-[var(--color-text-muted)]" />
                      <span className="text-xs font-mono text-text-muted">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, log.requestId)}
                      className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      title="Delete log"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="text-[13px] font-mono text-primary whitespace-nowrap overflow-hidden text-ellipsis mt-1">
                    {log.requestId?.substring(0, 8) ?? '-'}...
                  </div>
                  <div className="mt-2">
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                        getHttpStatusBadgeClasses(log.responseStatus)
                      )}
                    >
                      HTTP {log.responseStatus ?? '?'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-center p-8 text-[var(--color-text-muted)] italic text-sm">
                No debug logs found. Ensure Debug Mode is enabled.
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Details */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-deep">
          {selectedId && detail ? (
            <div className="flex flex-col">
              <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border-glass bg-bg-surface px-3 py-3 sm:px-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Selected Trace
                  </span>
                  <span className="break-all text-xs font-mono text-text-secondary">
                    {detail.requestId}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-secondary">
                  <div className="min-w-0">
                    <span className="text-text-muted">Captured:</span>
                    <span className="ml-2 font-mono">
                      {new Date(detail.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-text-muted">HTTP Status:</span>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-md border px-2 py-0.5 font-mono font-semibold',
                        getHttpStatusBadgeClasses(detail.responseStatus)
                      )}
                    >
                      {detail.responseStatus ?? 'Not captured'}
                    </span>
                  </div>
                </div>
              </div>
              <AccordionPanel
                title="Raw Request"
                content={formatContent(detail.rawRequest)}
                color="text-blue-400"
                defaultOpen={true}
              />
              {detail.requestHeaders && (
                <AccordionPanel
                  title="Request Headers"
                  content={formatContent(detail.requestHeaders)}
                  color="text-blue-400"
                />
              )}
              <AccordionPanel
                title="Transformed Request"
                content={formatContent(detail.transformedRequest)}
                color="text-purple-400"
              />
              <AccordionPanel
                title="Raw Response"
                content={formatContent(detail.rawResponse)}
                color="text-orange-400"
              />
              {detail.rawResponseSnapshot && (
                <AccordionPanel
                  title="Raw Response (Reconstructed)"
                  content={formatContent(detail.rawResponseSnapshot)}
                  color="text-orange-400"
                />
              )}
              {detail.responseHeaders && (
                <AccordionPanel
                  title="Response Headers"
                  content={formatContent(detail.responseHeaders)}
                  color="text-yellow-400"
                />
              )}
              <AccordionPanel
                title="Transformed Response"
                content={formatContent(detail.transformedResponse)}
                color="text-green-400"
                defaultOpen={true}
              />
              {detail.transformedResponseSnapshot && (
                <AccordionPanel
                  title="Transformed Response (Reconstructed)"
                  content={formatContent(detail.transformedResponseSnapshot)}
                  color="text-green-400"
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
              <Database size={48} opacity={0.2} />
              <p>Select a request trace to inspect details</p>
            </div>
          )}

          {loadingDetail && (
            <div className="absolute inset-0 bg-[rgba(15,23,42,0.5)] backdrop-blur-sm flex items-center justify-center z-10">
              <RefreshCw className="animate-spin text-[var(--color-primary)]" size={32} />
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={isDeleteAllModalOpen}
        onClose={() => setIsDeleteAllModalOpen(false)}
        title="Confirm Deletion"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsDeleteAllModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteAll} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete All Logs'}
            </Button>
          </>
        }
      >
        <p>Are you sure you want to delete ALL debug logs? This action cannot be undone.</p>
      </Modal>

      <Modal
        isOpen={isSingleDeleteModalOpen}
        onClose={() => setIsSingleDeleteModalOpen(false)}
        title="Confirm Deletion"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsSingleDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteSingle} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Log'}
            </Button>
          </>
        }
      >
        <p>Are you sure you want to delete this debug log? This action cannot be undone.</p>
      </Modal>
    </div>
  );
};

const AccordionPanel: React.FC<{
  title: string;
  content: string;
  color: string;
  defaultOpen?: boolean;
}> = ({ title, content, color, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // Monaco's wrapped-line layout becomes prohibitively expensive for captured
  // request bodies containing a very large escaped string (for example, a
  // prompt with many embedded newlines). Preserve wrapping for normal JSON,
  // but let exceptionally long lines scroll horizontally instead.
  const hasVeryLongLine = content.split('\n').some((line) => line.length > 10_000);
  const [copied, setCopied] = useState(false);
  const [folded, setFolded] = useState(false);
  const editorRef = useRef<any>(null);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isClipboardAvailable()) return;
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleFold = (e: React.MouseEvent) => {
    e.stopPropagation();
    const editor = editorRef.current;
    if (!editor) return;
    if (folded) {
      editor.trigger('unfoldAll', 'editor.unfoldAll', null);
    } else {
      // Fold everything first
      editor.trigger('foldAll', 'editor.foldAll', null);
      // Then unfold the outermost object (line 1) to keep it visible
      setTimeout(() => {
        editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
        editor.trigger('unfold', 'editor.unfold', null);
        editor.setSelection({ startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 });
      }, 50);
    }
    setFolded(!folded);
  };

  return (
    <div className="border-b border-border-glass bg-bg-surface">
      <div
        className="flex cursor-pointer items-center justify-between gap-3 bg-bg-hover px-3 py-3 transition-colors duration-200 select-none hover:bg-bg-glass sm:px-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className={clsx('truncate text-[11px] font-bold uppercase tracking-wider', color)}>
            {title}
          </span>
          <button
            className="bg-transparent border-0 text-text-muted p-0.5 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-white/10 hover:text-text"
            onClick={handleToggleFold}
            title={folded ? 'Unfold all' : 'Fold all'}
          >
            {folded ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          </button>
        </div>
        <button
          className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-white/10 hover:text-text"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </button>
      </div>
      <div
        className={clsx(
          'overflow-hidden transition-[max-height] duration-300 ease-in-out',
          isOpen ? 'max-h-[500px]' : 'max-h-0'
        )}
      >
        <div className="h-[280px] bg-[#1e1e1e] sm:h-[400px]">
          <Editor
            height="100%"
            defaultLanguage="json"
            theme="vs-dark"
            value={content}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'on',
              folding: true,
              wordWrap: hasVeryLongLine ? 'off' : 'on',
              padding: { top: 10, bottom: 10 },
            }}
          />
        </div>
      </div>
    </div>
  );
};
