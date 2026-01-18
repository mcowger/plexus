import React, { useEffect, useState } from 'react';
import { api, InferenceError } from '../lib/api';
import Editor from '@monaco-editor/react';
import { RefreshCw, Clock, AlertTriangle, ChevronDown, ChevronRight, Copy, Check, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useLocation } from 'react-router-dom';

export const Errors: React.FC = () => {
    const location = useLocation();
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
            setErrors(errors.filter(e => e.request_id !== selectedRequestIdForDelete));
            if (selectedId === selectedRequestIdForDelete) {
                setSelectedId(null);
                setSelectedError(null);
            }
            setIsSingleDeleteModalOpen(false);
            setSelectedRequestIdForDelete(null);
        } catch (e) {
            console.error("Failed to delete error log", e);
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
            const found = errors.find(e => e.request_id === selectedId);
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
        <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            <header className="flex justify-between items-center p-6 shrink-0">
                <div>
                    <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2 text-red-500 flex items-center gap-2">
                        <AlertTriangle size={24} />
                        Inference Errors
                    </h1>
                    <p className="text-[15px] text-text-secondary m-0">Investigate failed requests and exceptions</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleDeleteAll} variant="danger" className="flex items-center gap-2" disabled={errors.length === 0}>
                        <Trash2 size={16} />
                        Delete All
                    </Button>
                    <Button onClick={fetchErrors} variant="secondary" className="flex items-center gap-2">
                        <RefreshCw size={16} className={clsx(loading && "animate-spin")} />
                        Refresh
                    </Button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden border-t border-border-glass">
                {/* Left Pane: Error List */}
                <div className="w-[320px] border-r border-border-glass bg-bg-surface flex flex-col shrink-0">
                    <div className="p-4 border-b border-border-glass">
                        <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
                            Recent Errors
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                        {errors.map(err => (
                            <div 
                                key={err.id}
                                onClick={() => setSelectedId(err.request_id)}
                                className={clsx(
                                    "p-3 rounded-md cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover group",
                                    selectedId === err.request_id && "bg-bg-glass border-border-glass shadow-sm"
                                )}
                            >
                                <div className="w-full">
                                    <div className="flex items-center gap-2 mb-1 justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <Clock size={14} className="text-[var(--color-text-muted)]" />
                                            <span className="text-xs font-mono text-text-muted">
                                                {new Date(err.date).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDelete(e, err.request_id)}
                                            className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 opacity-0 transition-opacity"
                                            title="Delete error log"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <div className="text-[13px] font-mono text-primary whitespace-nowrap overflow-hidden text-ellipsis mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                                        {err.request_id.substring(0, 8)}...
                                    </div>
                                    <div className="mt-1 text-sm text-red-400 truncate" title={err.error_message}>
                                        {err.error_message}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {errors.length === 0 && (
                            <div className="text-center p-8 text-[var(--color-text-muted)] italic text-sm">
                                No errors found.
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Pane: Details */}
                <div className="flex-1 bg-bg-deep overflow-y-auto flex flex-col relative">
                    {selectedId && selectedError ? (
                        <div className="flex flex-col">
                             <div className="p-4 border-b border-[var(--color-border)] mb-4">
                                <h3 className="text-lg font-semibold text-red-500 mb-2">Error Details</h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="text-[var(--color-text-muted)]">Request ID:</span>
                                        <span className="ml-2 font-mono">{selectedError.request_id}</span>
                                    </div>
                                    <div>
                                        <span className="text-[var(--color-text-muted)]">Time:</span>
                                        <span className="ml-2">{new Date(selectedError.date).toLocaleString()}</span>
                                    </div>
                                </div>
                                {(() => {
                                    const details = parseDetails(selectedError.details);
                                    if (details && (details.provider || details.targetModel || details.url)) {
                                        return (
                                            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                                                <h4 className="text-sm font-semibold text-yellow-500 mb-2">Routing Information</h4>
                                                <div className="grid grid-cols-2 gap-4 text-sm">
                                                    {details.provider && (
                                                        <div>
                                                            <span className="text-[var(--color-text-muted)]">Provider:</span>
                                                            <span className="ml-2 font-mono text-blue-400">{details.provider}</span>
                                                        </div>
                                                    )}
                                                    {details.targetModel && (
                                                        <div>
                                                            <span className="text-[var(--color-text-muted)]">Target Model:</span>
                                                            <span className="ml-2 font-mono text-blue-400">{details.targetModel}</span>
                                                        </div>
                                                    )}
                                                    {details.targetApiType && (
                                                        <div>
                                                            <span className="text-[var(--color-text-muted)]">Target API:</span>
                                                            <span className="ml-2 font-mono text-blue-400">{details.targetApiType}</span>
                                                        </div>
                                                    )}
                                                    {details.statusCode && (
                                                        <div>
                                                            <span className="text-[var(--color-text-muted)]">Status Code:</span>
                                                            <span className="ml-2 font-mono text-red-400">{details.statusCode}</span>
                                                        </div>
                                                    )}
                                                    {details.url && (
                                                        <div className="col-span-2">
                                                            <span className="text-[var(--color-text-muted)]">Request URL:</span>
                                                            <div className="ml-2 font-mono text-xs text-blue-400 break-all mt-1">{details.url}</div>
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
                                content={selectedError.error_message}
                                color="text-red-400"
                                defaultOpen={true}
                                language="plaintext"
                            />
                             <AccordionPanel
                                title="Stack Trace"
                                content={selectedError.error_stack || '(No stack trace available)'}
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
                             {selectedError.details && (() => {
                                const details = parseDetails(selectedError.details);
                                // Show full details if there are fields we haven't displayed elsewhere
                                const displayedFields = ['provider', 'targetModel', 'targetApiType', 'url', 'statusCode', 'providerResponse', 'headers'];
                                const hasOtherFields = details && Object.keys(details).some(key => !displayedFields.includes(key));

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
                        <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
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
                        <Button variant="secondary" onClick={() => setIsDeleteAllModalOpen(false)}>Cancel</Button>
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
                        <Button variant="secondary" onClick={() => setIsSingleDeleteModalOpen(false)}>Cancel</Button>
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

const AccordionPanel: React.FC<{ 
    title: string; 
    content: string; 
    color: string;
    defaultOpen?: boolean;
    language?: string;
}> = ({ title, content, color, defaultOpen = false, language = 'json' }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="border-b border-border-glass bg-bg-surface">
            <div 
                className="px-4 py-3 cursor-pointer flex justify-between items-center bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass" 
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className={clsx("text-[11px] font-bold uppercase tracking-wider", color)}>{title}</span>
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
                    "overflow-hidden transition-[max-height] duration-300 ease-in-out",
                    isOpen ? "max-h-[500px]" : "max-h-0"
                )}
            >
                <div className="h-[400px] bg-[#1e1e1e]">
                    <Editor 
                        height="100%" 
                        defaultLanguage={language} 
                        theme="vs-dark"
                        value={content} 
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            fontSize: 12,
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            lineNumbers: 'off',
                            folding: true,
                            wordWrap: 'on',
                            padding: { top: 10, bottom: 10 }
                        }}
                    />
                </div>
            </div>
        </div>
    );
};
