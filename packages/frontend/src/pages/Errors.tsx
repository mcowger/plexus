import Editor from '@monaco-editor/react';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { api, InferenceError } from '../lib/api';
import { copyToClipboard, isClipboardAvailable } from '../lib/clipboard';

export const Errors: React.FC = () => {
  const location = useLocation();
  const { isAdmin, principal } = useAuth();
  const [errors, setErrors] = useState<InferenceError[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<InferenceError | null>(null);
  const [loading, setLoading] = useState(false);

  // Delete Modal State
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
  const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);
  const [selectedRequestIdForDelete, setSelectedRequestIdForDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (location.state?.requestId) {
      setSelectedId(location.state.requestId);
    }
  }, [location.state]);

  const fetchErrors = async () => {
    setLoading(true);
    try {
      const data = await api.getErrors(50);
      setErrors(data);
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
      await api.deleteAllErrors();
      await fetchErrors();
      setSelectedId(null);
      setSelectedError(null);
      setIsDeleteAllModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, requestId: string) => {
    e.stopPropagation();
    setSelectedRequestIdForDelete(requestId);
    setIsSingleDeleteModalOpen(true);
  };

  const confirmDeleteSingle = async () => {
    if (!selectedRequestIdForDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteError(selectedRequestIdForDelete);
      setErrors(errors.filter((e) => e.requestId !== selectedRequestIdForDelete));
      if (selectedId === selectedRequestIdForDelete) {
        setSelectedId(null);
        setSelectedError(null);
      }
      setIsSingleDeleteModalOpen(false);
      setSelectedRequestIdForDelete(null);
    } catch (e) {
      console.error('Failed to delete error log', e);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedId) {
      const found = errors.find((e) => e.requestId === selectedId);
      if (found) {
        setSelectedError(found);
      } else {
        // If not in current list, maybe fetch specific?
        // For now, assuming it's in the list or will appear on refresh
      }
    } else {
      setSelectedError(null);
    }
  }, [selectedId, errors]);

  const formatContent = (content: any) => {
    if (!content) return '';
    if (typeof content === 'string') {
      try {
        // Check if it looks like JSON
        if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
          return JSON.stringify(JSON.parse(content), null, 2);
        }
        return content;
      } catch {
        return content;
      }
    }
    return JSON.stringify(content, null, 2);
  };

  const parseDetails = (details: any) => {
    if (!details) return null;
    if (typeof details === 'string') {
      try {
        return JSON.parse(details);
      } catch {
        return { raw: details };
      }
    }
    return details;
  };

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <div className="shrink-0">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              <AlertTriangle size={20} className="text-rose-400" />
              Errors
            </span>
          }
          subtitle={
            principal?.role === 'limited' && principal.keyName
              ? `Errors for key "${principal.keyName}" only`
              : 'Grouped by signature · last 24h'
          }
          actions={
            <>
              {isAdmin && (
                <Button
                  onClick={handleDeleteAll}
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 size={16} />}
                  disabled={errors.length === 0}
                >
                  Delete All
                </Button>
              )}
              <Button
                onClick={fetchErrors}
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw size={16} className={clsx(loading && 'animate-spin')} />}
              >
                Refresh
              </Button>
            </>
          }
        />
      </div>

      <div className="border-border-glass flex min-h-0 flex-1 flex-col overflow-hidden border-t md:flex-row">
        {/* Left Pane: Error List */}
        <div className="border-border-glass bg-bg-surface flex max-h-[34vh] w-full shrink-0 flex-col border-b md:max-h-none md:w-[320px] md:border-r md:border-b-0">
          <div className="border-border-glass border-b p-3 sm:p-4">
            <span className="text-text-muted text-xs font-bold tracking-wider uppercase">
              Recent Errors
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
            {errors.map((err) => (
              <div
                key={err.id}
                onClick={() => setSelectedId(err.requestId)}
                className={clsx(
                  'hover:bg-bg-hover group cursor-pointer rounded-md border border-transparent p-3 transition-all duration-200',
                  selectedId === err.requestId && 'bg-bg-glass border-border-glass shadow-sm'
                )}
              >
                <div className="w-full">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-[var(--color-text-muted)]" />
                      <span className="text-text-muted font-mono text-xs">
                        {new Date(err.date).toLocaleTimeString()}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, err.requestId)}
                      className="text-text-muted hover:text-danger flex cursor-pointer items-center justify-center rounded border-0 bg-transparent p-1 opacity-100 transition-all duration-200 hover:bg-red-600/10 md:opacity-0 md:group-hover:opacity-100"
                      title="Delete error log"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="text-primary mt-1 overflow-hidden font-mono text-xs text-[13px] text-ellipsis whitespace-nowrap text-[var(--color-text-muted)]">
                    {err.requestId?.substring(0, 8) ?? '-'}...
                  </div>
                  <div className="mt-1 truncate text-sm text-red-400" title={err.errorMessage}>
                    {err.errorMessage}
                  </div>
                </div>
              </div>
            ))}
            {errors.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)] italic">
                No errors found.
              </div>
            )}
          </div>
        </div>

        {/* Right Pane: Details */}
        <div className="bg-bg-deep relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {selectedId && selectedError ? (
            <div className="flex flex-col">
              <div className="mb-3 border-b border-[var(--color-border)] p-3 sm:mb-4 sm:p-4">
                <h3 className="mb-2 text-base font-semibold text-red-500 sm:text-lg">
                  Error Details
                </h3>
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-4 sm:text-sm">
                  <div className="min-w-0">
                    <span className="text-[var(--color-text-muted)]">Request ID:</span>
                    <span className="ml-2 font-mono break-all">{selectedError.requestId}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[var(--color-text-muted)]">Time:</span>
                    <span className="ml-2">{new Date(selectedError.date).toLocaleString()}</span>
                  </div>
                </div>
                {(() => {
                  const details = parseDetails(selectedError.details);
                  if (details && (details.provider || details.targetModel || details.url)) {
                    return (
                      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                        <h4 className="mb-2 text-sm font-semibold text-yellow-500">
                          Routing Information
                        </h4>
                        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-4 sm:text-sm">
                          {details.provider && (
                            <div className="min-w-0">
                              <span className="text-[var(--color-text-muted)]">Provider:</span>
                              <span className="ml-2 font-mono break-all text-blue-400">
                                {details.provider}
                              </span>
                            </div>
                          )}
                          {details.targetModel && (
                            <div className="min-w-0">
                              <span className="text-[var(--color-text-muted)]">Target Model:</span>
                              <span className="ml-2 font-mono break-all text-blue-400">
                                {details.targetModel}
                              </span>
                            </div>
                          )}
                          {details.targetApiType && (
                            <div className="min-w-0">
                              <span className="text-[var(--color-text-muted)]">Target API:</span>
                              <span className="ml-2 font-mono break-all text-blue-400">
                                {details.targetApiType}
                              </span>
                            </div>
                          )}
                          {details.statusCode && (
                            <div className="min-w-0">
                              <span className="text-[var(--color-text-muted)]">Status Code:</span>
                              <span className="ml-2 font-mono text-red-400">
                                {details.statusCode}
                              </span>
                            </div>
                          )}
                          {details.url && (
                            <div className="sm:col-span-2">
                              <span className="text-[var(--color-text-muted)]">Request URL:</span>
                              <div className="mt-1 ml-2 font-mono text-xs break-all text-blue-400">
                                {details.url}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              <AccordionPanel
                title="Message"
                content={selectedError.errorMessage}
                color="text-red-400"
                defaultOpen={true}
                language="plaintext"
              />
              <AccordionPanel
                title="Stack Trace"
                content={selectedError.errorStack || '(No stack trace available)'}
                color="text-orange-400"
                defaultOpen={true}
                language="plaintext"
              />
              {(() => {
                const details = parseDetails(selectedError.details);
                if (details?.providerResponse) {
                  return (
                    <AccordionPanel
                      title="Provider Response"
                      content={details.providerResponse}
                      color="text-purple-400"
                      defaultOpen={false}
                      language="plaintext"
                    />
                  );
                }
                return null;
              })()}
              {(() => {
                const details = parseDetails(selectedError.details);
                if (details?.headers) {
                  return (
                    <AccordionPanel
                      title="Request Headers"
                      content={formatContent(details.headers)}
                      color="text-cyan-400"
                      defaultOpen={false}
                    />
                  );
                }
                return null;
              })()}
              {selectedError.details &&
                (() => {
                  const details = parseDetails(selectedError.details);
                  // Show full details if there are fields we haven't displayed elsewhere
                  const displayedFields = [
                    'provider',
                    'targetModel',
                    'targetApiType',
                    'url',
                    'statusCode',
                    'providerResponse',
                    'headers',
                  ];
                  const hasOtherFields =
                    details && Object.keys(details).some((key) => !displayedFields.includes(key));

                  if (hasOtherFields) {
                    return (
                      <AccordionPanel
                        title="Additional Details"
                        content={formatContent(details)}
                        color="text-blue-400"
                        defaultOpen={false}
                      />
                    );
                  }
                  return null;
                })()}
            </div>
          ) : (
            <div className="text-text-muted flex h-full flex-col items-center justify-center gap-4">
              <AlertTriangle size={48} opacity={0.2} />
              <p>Select an error to inspect details</p>
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
              {isDeleting ? 'Deleting...' : 'Delete All Errors'}
            </Button>
          </>
        }
      >
        <p>Are you sure you want to delete ALL error logs? This action cannot be undone.</p>
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
              {isDeleting ? 'Deleting...' : 'Delete Error Log'}
            </Button>
          </>
        }
      >
        <p>Are you sure you want to delete this error log? This action cannot be undone.</p>
      </Modal>
    </div>
  );
};

const EDITOR_MIN_HEIGHT = 60;
const EDITOR_MAX_HEIGHT = 600;

const AccordionPanel: React.FC<{
  title: string;
  content: unknown;
  color: string;
  defaultOpen?: boolean;
  language?: string;
}> = ({ title, content, color, defaultOpen = false, language = 'json' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const [editorHeight, setEditorHeight] = useState(EDITOR_MIN_HEIGHT);

  const editorContent = (() => {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  })();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isClipboardAvailable()) return;
    const success = await copyToClipboard(editorContent);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="border-border-glass bg-bg-surface border-b">
      <div
        className="bg-bg-hover hover:bg-bg-glass flex cursor-pointer items-center justify-between px-3 py-2.5 transition-colors duration-200 select-none sm:px-4 sm:py-3"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className={clsx('text-[11px] font-bold tracking-wider uppercase', color)}>
            {title}
          </span>
        </div>
        <button
          className="text-text-muted hover:text-text flex cursor-pointer items-center justify-center rounded border-0 bg-transparent p-1 transition-all duration-200 hover:bg-white/10"
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </button>
      </div>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: isOpen ? editorHeight : 0 }}
      >
        <div className="bg-[#1e1e1e]" style={{ height: editorHeight }}>
          <Editor
            height="100%"
            defaultLanguage={language}
            theme="vs-dark"
            value={editorContent}
            onMount={(editor) => {
              const updateHeight = () => {
                const contentHeight = editor.getContentHeight();
                setEditorHeight(
                  Math.min(Math.max(contentHeight, EDITOR_MIN_HEIGHT), EDITOR_MAX_HEIGHT)
                );
              };
              updateHeight();
              editor.onDidContentSizeChange(updateHeight);
            }}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineNumbers: 'off',
              folding: true,
              wordWrap: 'on',
              padding: { top: 10, bottom: 10 },
            }}
          />
        </div>
      </div>
    </div>
  );
};
