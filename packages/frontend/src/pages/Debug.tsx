import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Editor from '@monaco-editor/react';
import { RefreshCw, Clock, Database, ArrowRight, ChevronDown, ChevronRight, Copy, Check, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../components/ui/Button';

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
    const [logs, setLogs] = useState<DebugLogMeta[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<DebugLogDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingDetail, setLoadingDetail] = useState(false);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const data = await api.getDebugLogs(50);
            setLogs(data);
            if (data.length > 0 && !selectedId) {
                // Optionally select first? No, let user choose.
            }
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAll = async () => {
        if (!confirm("Are you sure you want to delete ALL debug logs?")) return;
        setLoading(true);
        try {
            await api.deleteAllDebugLogs();
            await fetchLogs();
            setSelectedId(null);
            setDetail(null);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent, requestId: string) => {
        e.stopPropagation();
        if (!confirm("Delete this log?")) return;
        
        try {
            await api.deleteDebugLog(requestId);
            setLogs(logs.filter(l => l.requestId !== requestId));
            if (selectedId === requestId) {
                setSelectedId(null);
                setDetail(null);
            }
        } catch (e) {
            console.error("Failed to delete log", e);
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
        <div className="debug-page">
            <header className="debug-header">
                <div>
                    <h1 className="page-title">Debug Traces</h1>
                    <p className="page-description">Inspect full request/response lifecycles</p>
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

            <div className="debug-content">
                {/* Left Pane: Request List */}
                <div className="debug-sidebar">
                    <div className="debug-list-header">
                        <span className="debug-list-title">
                            Recent Requests
                        </span>
                    </div>
                    <div className="debug-list">
                        {logs.map(log => (
                            <div 
                                key={log.requestId}
                                onClick={() => setSelectedId(log.requestId)}
                                className={clsx(
                                    "debug-list-item group",
                                    selectedId === log.requestId && "selected"
                                )}
                            >
                                <div className="debug-item-content w-full">
                                    <div className="debug-item-meta justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <Clock size={14} className="text-[var(--color-text-muted)]" />
                                            <span className="debug-time">
                                                {new Date(log.createdAt).toLocaleTimeString()}
                                            </span>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDelete(e, log.requestId)}
                                            className="debug-delete-btn group-hover-visible"
                                            title="Delete log"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <div className="debug-id mt-1">
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
                <div className="debug-main">
                    {selectedId && detail ? (
                        <div className="debug-accordion-container">
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
                        <div className="debug-empty">
                            <Database size={48} opacity={0.2} />
                            <p>Select a request trace to inspect details</p>
                        </div>
                    )}
                    
                    {loadingDetail && (
                        <div className="debug-loading-overlay">
                            <RefreshCw className="animate-spin text-[var(--color-primary)]" size={32} />
                        </div>
                    )}
                </div>
            </div>
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
        <div className="debug-accordion-item">
            <div 
                className="debug-accordion-header" 
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className={clsx("debug-accordion-title", color)}>{title}</span>
                </div>
                <button 
                    className="debug-copy-btn"
                    onClick={handleCopy}
                    title="Copy to clipboard"
                >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
            </div>
            <div 
                className={clsx(
                    "debug-accordion-content",
                    isOpen ? "open" : "closed"
                )}
            >
                <div className="debug-editor-container">
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
