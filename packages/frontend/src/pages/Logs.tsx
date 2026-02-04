import React, { useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { CostToolTip } from '../components/ui/CostToolTip';
import { api, UsageRecord, formatLargeNumber } from '../lib/api';
import { formatCost, formatMs, formatTPS } from '../lib/format';
import { ChevronLeft, ChevronRight, Search, Filter, Trash2, Bug, Zap, ZapOff, AlertTriangle, Languages, MoveHorizontal, CloudUpload, CloudDownload, BrainCog, PackageOpen, Copy, Variable, AudioLines, Volume2, Wrench, MessagesSquare, PlugZap, CirclePause, Octagon, Hammer, RulerDimensionLine, ChevronDown, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
// @ts-ignore
import messagesLogo from '../assets/messages.svg';
// @ts-ignore
import antigravityLogo from '../assets/antigravity.svg';
// @ts-ignore
import chatLogo from '../assets/chat.svg';
// @ts-ignore
import geminiLogo from '../assets/gemini.svg';

export const Logs = () => {
    const navigate = useNavigate();
    const { adminKey } = useAuth();
    const [logs, setLogs] = useState<UsageRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [limit] = useState(20);
    const [offset, setOffset] = useState(0);
    const [newestLogId, setNewestLogId] = useState<string | null>(null);
    const [filters, setFilters] = useState({
        incomingModelAlias: '',
        provider: ''
    });

    const apiLogos: Record<string, string> = {
        'messages': messagesLogo,
        'antigravity': antigravityLogo,
        'chat': chatLogo,
        'gemini': geminiLogo
    };

    // Delete Modal State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteMode, setDeleteMode] = useState<'all' | 'older'>('older');
    const [olderThanDays, setOlderThanDays] = useState(7);
    const [isDeleting, setIsDeleting] = useState(false);

    // Single Delete State
    const [selectedLogIdForDelete, setSelectedLogIdForDelete] = useState<string | null>(null);
    const [isSingleDeleteModalOpen, setIsSingleDeleteModalOpen] = useState(false);

    const filtersRef = useRef(filters);

    useEffect(() => {
        filtersRef.current = filters;
    }, [filters]);

    const loadLogs = async () => {
        setLoading(true);
        try {
            const cleanFilters: Record<string, any> = {};
            if (filters.incomingModelAlias) cleanFilters.incomingModelAlias = filters.incomingModelAlias;
            if (filters.provider) cleanFilters.provider = filters.provider;

            const res = await api.getLogs(limit, offset, cleanFilters);
            setLogs(res.data);
            setTotal(Number(res.total) || 0);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAll = () => {
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        setIsDeleting(true);
        try {
            if (deleteMode === 'all') {
                await api.deleteAllUsageLogs();
            } else {
                await api.deleteAllUsageLogs(olderThanDays);
            }
            // Reset to first page
            setOffset(0);
            await loadLogs();
            setIsDeleteModalOpen(false);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDelete = (requestId: string) => {
        setSelectedLogIdForDelete(requestId);
        setIsSingleDeleteModalOpen(true);
    };

    const confirmDeleteSingle = async () => {
        if (!selectedLogIdForDelete) return;
        setIsDeleting(true);
        try {
            await api.deleteUsageLog(selectedLogIdForDelete);
            setLogs(logs.filter(l => l.requestId !== selectedLogIdForDelete));
            setTotal(prev => Math.max(0, prev - 1));
            setIsSingleDeleteModalOpen(false);
            setSelectedLogIdForDelete(null);
        } catch (e) {
            console.error("Failed to delete log", e);
        } finally {
            setIsDeleting(false);
        }
    };

    useEffect(() => {
        loadLogs();
    }, [offset, limit]); // Refresh when page changes

    useEffect(() => {
        if (offset !== 0 || !adminKey) return;

        const controller = new AbortController();

        const connect = async () => {
            try {
                const response = await fetch('/v0/management/events', {
                    headers: {
                        'x-admin-key': adminKey
                    },
                    signal: controller.signal
                });

                if (!response.ok) {
                    throw new Error(`Failed to connect: ${response.statusText}`);
                }

                const reader = response.body?.getReader();
                if (!reader) return;

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n'); // SSE messages are separated by double newline
                    buffer = lines.pop() || '';

                    for (const block of lines) {
                        const blockLines = block.split('\n');
                        let eventData = '';
                        let isLogEvent = false;

                        for (const line of blockLines) {
                            if (line.startsWith('event: log')) {
                                isLogEvent = true;
                            } else if (line.startsWith('event: ping')) {
                                // Ignore ping events
                                isLogEvent = false;
                            } else if (line.startsWith('data: ')) {
                                eventData = line.slice(6);
                            }
                        }

                        if (isLogEvent && eventData) {
                            try {
                                const newLog = JSON.parse(eventData);
                                const currentFilters = filtersRef.current;

                                // Client-side filtering to match server-side LIKE behavior
                                let matches = true;
                                if (currentFilters.incomingModelAlias &&
                                    !newLog.incomingModelAlias?.toLowerCase().includes(currentFilters.incomingModelAlias.toLowerCase())) {
                                    matches = false;
                                }
                                if (currentFilters.provider &&
                                    !newLog.provider?.toLowerCase().includes(currentFilters.provider.toLowerCase())) {
                                    matches = false;
                                }

                                if (matches) {
                                    setLogs(prev => {
                                        if (prev.some(l => l.requestId === newLog.requestId)) return prev;
                                        const updated = [newLog, ...prev];
                                        if (updated.length > limit) return updated.slice(0, limit);
                                        return updated;
                                    });
                                    setTotal(prev => Number(prev) + 1);
                                    setNewestLogId(newLog.requestId);
                                }
                            } catch (e) {
                                console.error("Failed to parse log event", e);
                            }
                        }
                    }
                }
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error('Log stream error:', err);
                }
            }
        };

        connect();

        return () => {
            controller.abort();
        };
    }, [offset, limit, adminKey]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setOffset(0); // Reset to first page
        loadLogs();
    };

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    return (
        <div className="min-h-screen p-6 transition-all duration-300 bg-linear-to-br from-bg-deep to-bg-surface">
            <div className="mb-4">
                <h1 className="font-heading text-3xl font-bold text-text m-0">Logs</h1>
            </div>

            <Card className="glass-bg rounded-lg p-3 max-w-full shadow-xl overflow-hidden flex flex-col gap-2">
                <div className="mb-4">
                    <form onSubmit={handleSearch} className="flex gap-2 mb-4 justify-between">
                        <div className="flex gap-2">
                            <div className="relative w-62.5">
                                <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <Input
                                    placeholder="Filter by Model..."
                                    value={filters.incomingModelAlias}
                                    onChange={e => setFilters({ ...filters, incomingModelAlias: e.target.value })}
                                    style={{ paddingLeft: '32px' }}
                                />
                            </div>
                            <div className="relative w-50">
                                <Filter size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                                <Input
                                    placeholder="Filter by Provider..."
                                    value={filters.provider}
                                    onChange={e => setFilters({ ...filters, provider: e.target.value })}
                                    style={{ paddingLeft: '32px' }}
                                />
                            </div>
                            <Button type="submit" variant="primary">Search</Button>
                        </div>
                        <Button onClick={handleDeleteAll} variant="danger" className="flex items-center gap-2" disabled={logs.length === 0} type="button">
                            <Trash2 size={16} />
                            Delete All
                        </Button>
                    </form>
                </div>

                <div className="overflow-x-auto -mx-3 px-3">
                    <table className="w-full border-collapse font-body text-[13px]">
                        <thead>
                            <tr className="text-center border-b border-border">
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Date</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Key</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">API</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Model</th>
                                {/* <th style={{ padding: '6px' }}>Provider</th> */}
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap" style={{ width: '125px' }}>Tokens</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap" style={{ minWidth: '70px' }}>Cost</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Perf</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Meta</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass border-r border-r-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Status</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">
                                                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                        <Trash2 size={12} />
                                                    </div>
                                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={11} className="p-5 text-center">Loading...</td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="p-5 text-center">No logs found</td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr
                                        key={log.requestId}
                                        className={clsx("group border-b border-border-glass hover:bg-bg-hover", log.requestId === newestLogId && 'animate-pulse-fade')}
                                    >
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontWeight: '500' }}>{new Date(log.date).toLocaleTimeString()}</span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {new Date(log.date).toISOString().split('T')[0]}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontWeight: '500' }}>{log.apiKey || '-'}</span>
                                                {log.attribution && (
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                        {log.attribution}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td
                                            className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
                                            title={`Incoming: ${log.incomingApiType || '?'} → Outgoing: ${log.outgoingApiType || '?'} • ${log.isStreamed ? 'Streamed' : 'Non-streamed'} • ${log.isPassthrough ? 'Direct/Passthrough' : 'Translated'}`}
                                            style={{ cursor: 'help' }}
                                        >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {/* API type icons */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                    <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                                                        {log.incomingApiType === 'embeddings' ? (
                                                            <Variable size={16} className="text-green-500" />
                                                        ) : log.incomingApiType === 'transcriptions' ? (
                                                            <AudioLines size={16} className="text-purple-500" />
                                                        ) : log.incomingApiType === 'speech' ? (
                                                            <Volume2 size={16} className="text-orange-500" />
                                                         ) : log.incomingApiType === 'images' ? (
                                                            <ImageIcon size={16} className="text-fuchsia-500" />
                                                        ) : log.incomingApiType === 'responses' ? (
                                                            <MessagesSquare size={16} className="text-cyan-500" />
                                                        ) : log.incomingApiType && apiLogos[log.incomingApiType] ? (
                                                            <img
                                                                src={apiLogos[log.incomingApiType]}
                                                                alt={log.incomingApiType}
                                                                style={{ width: '16px', height: '16px' }}
                                                            />
                                                        ) : '?'}
                                                    </div>
                                                    <span style={{ width: '14px', textAlign: 'center' }}>→</span>
                                                    <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                                                        {log.outgoingApiType === 'embeddings' ? (
                                                            <Variable size={16} className="text-green-500" />
                                                        ) : log.outgoingApiType === 'transcriptions' ? (
                                                            <AudioLines size={16} className="text-purple-500" />
                                                        ) : log.outgoingApiType === 'speech' ? (
                                                            <Volume2 size={16} className="text-orange-500" />
                                                         ) : log.outgoingApiType === 'images' ? (
                                                            <ImageIcon size={16} className="text-fuchsia-500" />
                                                        ) : log.outgoingApiType === 'responses' ? (
                                                            <MessagesSquare size={16} className="text-cyan-500" />
                                                        ) : log.outgoingApiType && apiLogos[log.outgoingApiType] ? (
                                                            <img
                                                                src={apiLogos[log.outgoingApiType]}
                                                                alt={log.outgoingApiType}
                                                                style={{ width: '16px', height: '16px' }}
                                                            />
                                                        ) : '?'}
                                                    </div>
                                                </div>
                                                <div style={{ borderTop: '1px solid var(--color-border-glass)', margin: '1px 4px', width: '44px' }}></div>
                                                {/* Streaming/Passthrough icons */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                    <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                                                        {log.isStreamed ?
                                                            <Zap size={12} className="text-blue-400" /> :
                                                            <ZapOff size={12} className="text-gray-400" />
                                                        }
                                                    </div>
                                                    <span style={{ width: '14px' }}></span>
                                                    <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                                                        {log.isPassthrough ?
                                                            <MoveHorizontal size={12} className="text-yellow-500" /> :
                                                            <Languages size={12} className="text-purple-400" />
                                                        }
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                <div className="group/model flex items-center gap-1">
                                                    <span>{log.incomingModelAlias || '-'}</span>
                                                    {log.incomingModelAlias && log.incomingModelAlias !== '-' && (
                                                        <button
                                                            onClick={() => navigator.clipboard.writeText(log.incomingModelAlias || '')}
                                                            className="opacity-0 group-hover/model:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer p-0 flex items-center"
                                                            title="Copy incoming model alias"
                                                        >
                                                            <Copy size={12} className="text-text-secondary hover:text-text" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="group/selected flex items-center gap-1">
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.9em' }}>{log.provider || '-'}:{log.selectedModelName || '-'}</span>
                                                    {log.selectedModelName && log.selectedModelName !== '-' && (
                                                        <button
                                                            onClick={() => navigator.clipboard.writeText(log.selectedModelName || '')}
                                                            className="opacity-0 group-hover/selected:opacity-100 transition-opacity bg-transparent border-0 cursor-pointer p-0 flex items-center"
                                                            title="Copy selected model name"
                                                        >
                                                            <Copy size={10} className="text-text-secondary hover:text-text" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td
                                            className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle"
                                            title={`Input: ${(log.tokensInput || 0) === 0 ? '-' : formatLargeNumber(log.tokensInput || 0)} • Output: ${(log.tokensOutput || 0) === 0 ? '-' : formatLargeNumber(log.tokensOutput || 0)} • Reasoning: ${(log.tokensReasoning || 0) === 0 ? '-' : formatLargeNumber(log.tokensReasoning || 0)} • Cached: ${(log.tokensCached || 0) === 0 ? '-' : formatLargeNumber(log.tokensCached || 0)}${log.tokensEstimated ? ' • * = Estimated' : ''}`}
                                            style={{ cursor: 'help' }}
                                        >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {/* Row 1: Input and Reasoning */}
                                                <div style={{ display: 'flex', gap: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudUpload size={12} className="text-blue-400" />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '30px' }}>
                                                            {(log.tokensInput || 0) === 0 ? '-' : formatLargeNumber(log.tokensInput || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <BrainCog size={12} className="text-purple-400" />
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '30px' }}>
                                                            {(log.tokensReasoning || 0) === 0 ? '-' : formatLargeNumber(log.tokensReasoning || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Row 2: Output and Cache */}
                                                <div style={{ display: 'flex', gap: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudDownload size={12} className="text-green-400" />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '30px' }}>
                                                            {(log.tokensOutput || 0) === 0 ? '-' : formatLargeNumber(log.tokensOutput || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <PackageOpen size={12} className="text-orange-400" />
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '30px' }}>
                                                            {(log.tokensCached || 0) === 0 ? '-' : formatLargeNumber(log.tokensCached || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 border-b border-border-glass text-text align-middle">
                                            {log.costTotal !== undefined && log.costTotal !== null ? (
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                    {/* Left side: Total cost */}
                                                    <div style={{ minWidth: '50px' }}>
                                                        {log.costSource ? (
                                                            <CostToolTip source={log.costSource} costMetadata={log.costMetadata}>
                                                                <span style={{ fontWeight: '500', cursor: 'help' }}>
                                                                    {log.costTotal === 0 ? '∅' : formatCost(log.costTotal)}
                                                                </span>
                                                            </CostToolTip>
                                                        ) : (
                                                            <span style={{ fontWeight: '500' }}>
                                                                {log.costTotal === 0 ? '∅' : formatCost(log.costTotal)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {/* Right side: Breakdown */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <CloudUpload size={10} className="text-blue-400" />
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '35px' }}>
                                                                {log.costInput === 0 ? '∅' : formatCost(log.costInput || 0)}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <CloudDownload size={10} className="text-green-400" />
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '35px' }}>
                                                                {log.costOutput === 0 ? '∅' : formatCost(log.costOutput || 0)}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <PackageOpen size={10} className="text-orange-400" />
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '35px' }}>
                                                                {log.costCached === 0 ? '∅' : formatCost(log.costCached || 0)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '1.2em' }}>∅</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span>Duration: {formatMs(log.durationMs)}</span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {log.ttftMs && log.ttftMs > 0 ? `TTFT: ${formatMs(log.ttftMs)}` : ''}
                                                </span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {log.tokensPerSec && log.tokensPerSec > 0 ? `TPS: ${formatTPS(log.tokensPerSec)}` : ''}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-center border-b border-border-glass text-text align-middle">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {/* Row 1: Messages and Tool calls */}
                                                <div style={{ display: 'flex', gap: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-blue-400">
                                                        <MessagesSquare size={12} />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}>
                                                            {log.messageCount || 0}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-green-400">
                                                        <PlugZap size={12} />
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '20px' }}>
                                                            {log.toolCallsCount || 0}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Row 2: Tools defined and Finish reason */}
                                                <div style={{ display: 'flex', gap: '16px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-orange-400">
                                                        <Wrench size={12} />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em', minWidth: '20px' }}>
                                                            {log.toolsDefined || 0}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        {log.finishReason === 'end_turn' ? <CirclePause size={12} className="text-yellow-500" /> :
                                                         log.finishReason === 'stop' ? <Octagon size={12} className="text-red-500" /> :
                                                         log.finishReason === 'tool_calls' ? <Hammer size={12} className="text-purple-500" /> :
                                                         log.finishReason === 'length' || log.finishReason === 'max_tokens' ? <RulerDimensionLine size={12} className="text-pink-400" /> :
                                                         <ChevronDown size={12} className="text-gray-400" />}
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', minWidth: '20px' }}>
                                                            {log.finishReason || '-'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                                            <div className="flex gap-2 items-center">
                                                {log.hasError && (
                                                    <button
                                                        onClick={() => navigate('/errors', { state: { requestId: log.requestId } })}
                                                        className={clsx('inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 border', 
                                                            'text-danger border-danger/30 bg-red-500/15 hover:bg-red-500/25')}
                                                        style={{ width: '52px' }}
                                                        title="View Error Details"
                                                    >
                                                        <AlertTriangle size={12} />
                                                        <span style={{ fontWeight: 600 }}>✗</span>
                                                    </button>
                                                )}
                                                {log.hasDebug && (
                                                    <button
                                                        onClick={() => navigate('/debug', { state: { requestId: log.requestId } })}
                                                        className={clsx('inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium cursor-pointer transition-all duration-200 border', 
                                                            'text-blue-400 border-blue-400/30 bg-blue-500/15 hover:bg-blue-500/25')}
                                                        style={{ width: '52px' }}
                                                        title="View Debug Trace"
                                                    >
                                                        <Bug size={12} />
                                                        <span style={{ fontWeight: 600 }}>✓</span>
                                                    </button>
                                                )}
                                                {!log.hasError && !log.hasDebug && (
                                                    <div className={clsx('inline-flex items-center justify-center gap-1.5 py-1 px-2 rounded-xl text-xs font-medium border', 
                                                        log.responseStatus === 'success' 
                                                            ? 'text-success border-success/30 bg-emerald-500/15' 
                                                            : 'text-danger border-danger/30 bg-red-500/15')}
                                                        style={{ width: '52px' }}>
                                                        <span style={{ fontWeight: 600 }}>{log.responseStatus === 'success' ? '✓' : '✗'}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                                            <button
                                                onClick={() => handleDelete(log.requestId)}
                                                className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 opacity-0"
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

                <div className="flex justify-end items-center mt-5 gap-3">
                    <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                        Page {currentPage} of {Math.max(1, totalPages)}
                    </span>
                    <div className="flex gap-1">
                        <Button
                            variant="secondary"
                            disabled={offset === 0}
                            onClick={() => setOffset(Math.max(0, offset - limit))}
                        >
                            <ChevronLeft size={16} />
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={offset + limit >= total}
                            onClick={() => setOffset(offset + limit)}
                        >
                            <ChevronRight size={16} />
                        </Button>
                    </div>
                </div>
            </Card>

            <Modal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                title="Confirm Deletion"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
                        <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
                            {isDeleting ? 'Deleting...' : 'Delete Logs'}
                        </Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <p>Select which logs you would like to delete:</p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="radio"
                            id="delete-older"
                            name="deleteMode"
                            checked={deleteMode === 'older'}
                            onChange={() => setDeleteMode('older')}
                        />
                        <label htmlFor="delete-older">Delete logs older than</label>
                        <Input
                            type="number"
                            min="1"
                            value={olderThanDays}
                            onChange={(e) => setOlderThanDays(parseInt(e.target.value) || 1)}
                            style={{ width: '60px', padding: '4px 8px' }}
                            disabled={deleteMode !== 'older'}
                        />
                        <span>days</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="radio"
                            id="delete-all"
                            name="deleteMode"
                            checked={deleteMode === 'all'}
                            onChange={() => setDeleteMode('all')}
                        />
                        <label htmlFor="delete-all" style={{ color: 'var(--color-danger)' }}>
                            Delete ALL logs (Cannot be undone)
                        </label>
                    </div>
                </div>
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
                <p>Are you sure you want to delete log <strong>{selectedLogIdForDelete}</strong>? This action cannot be undone.</p>
            </Modal>
        </div>
    );
};
