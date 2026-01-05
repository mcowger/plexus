import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Editor from '@monaco-editor/react';
import { RefreshCw, Clock, Database, ChevronDown, ChevronRight, Copy, Check, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useLocation } from 'react-router-dom';

interface DebugLogMeta {
    requestId: string;
    createdAt: number;
}

interface DebugLogDetail extends DebugLogMeta {
    rawRequest: string | object;
    transformedRequest: string | object;
    rawResponse: string | object;
    transformedResponse: string | object;
    rawResponseSnapshot?: string | object;
    transformedResponseSnapshot?: string | object;
}

export const Debug: React.FC = () => {
    const location = useLocation();
    const [logs, setLogs] = useState<DebugLogMeta[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<DebugLogDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);

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
            setLogs(logs.filter(l => l.requestId !== selectedLogIdForDelete));
            if (selectedId === selectedLogIdForDelete) {
                setSelectedId(null);
                setDetail(null);
            }
            setIsSingleDeleteModalOpen(false);
            setSelectedLogIdForDelete(null);
        } catch (e) {
            console.error("Failed to delete log", e);
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
            api.getDebugLogDetail(selectedId).then(data => {
                setDetail(data);
                setLoadingDetail(false);
            });
        } else {
            setDetail(null);
        }
    }, [selectedId]);

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

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            <header className="flex justify-between items-center p-6 shrink-0">
                <div>
                    <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Debug Traces</h1>
                    <p className="text-[15px] text-text-secondary m-0">Inspect full request/response lifecycles</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleDeleteAll} variant="danger" className="flex items-center gap-2" disabled={logs.length === 0}>
                        <Trash2 size={16} />
                        Delete All
                    </Button>
                    <Button onClick={fetchLogs} variant="secondary" className="flex items-center gap-2">
                        <RefreshCw size={16} className={clsx(loading && "animate-spin")} />
                        Refresh
                    </Button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden border-t border-border-glass">
                {/* Left Pane: Request List */}
                <div className="w-[320px] border-r border-border-glass bg-bg-surface flex flex-col shrink-0">
                    <div className="p-4 border-b border-border-glass">
                        <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
                            Recent Requests
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                        {logs.map(log => (
                            <div 
                                key={log.requestId}
                                onClick={() => setSelectedId(log.requestId)}
                                className={clsx(
                                    "p-3 rounded-md cursor-pointer transition-all duration-200 border border-transparent hover:bg-bg-hover group",
                                    selectedId === log.requestId && "bg-bg-glass border-border-glass shadow-sm"
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
                                            className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 opacity-0 transition-opacity"
                                            title="Delete log"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <div className="text-[13px] font-mono text-primary whitespace-nowrap overflow-hidden text-ellipsis mt-1">
                                        {log.requestId.substring(0, 8)}...
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
                <div className="flex-1 bg-bg-deep overflow-y-auto flex flex-col relative">
                    {selectedId && detail ? (
                        <div className="flex flex-col">
                             <AccordionPanel 
                                title="Raw Request" 
                                content={formatContent(detail.rawRequest)} 
                                color="text-blue-400"
                                defaultOpen={true}
                            />
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
                        <Button variant="secondary" onClick={() => setIsDeleteAllModalOpen(false)}>Cancel</Button>
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
                        <Button variant="secondary" onClick={() => setIsSingleDeleteModalOpen(false)}>Cancel</Button>
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
                        defaultLanguage="json" 
                        theme="vs-dark"
                        value={content} 
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            fontSize: 12,
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            lineNumbers: 'on',
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
