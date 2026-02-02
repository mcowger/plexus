import React, { useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { CostToolTip } from '../components/ui/CostToolTip';
import { api, UsageRecord, formatLargeNumber } from '../lib/api';
import { formatCost, formatMs, formatTPS } from '../lib/format';
import { ChevronLeft, ChevronRight, Search, Filter, Trash2, Bug, Zap, ZapOff, AlertTriangle, Languages, MoveHorizontal, CloudUpload, CloudDownload, BrainCog, PackageOpen, Globe, ChartCandlestick, CircleDollarSign, Copy, Variable, AudioLines, Volume2, Wrench, MessagesSquare, GitFork, CheckCircle2, ChevronDown, Image as ImageIcon } from 'lucide-react';
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
            setTotal(res.total);
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
                                    setTotal(prev => prev + 1);
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
                            <tr className="text-left border-b border-border">
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Date</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Key</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Source IP</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">API (In/Out)</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Model (In/Sel)</th>
                                {/* <th style={{ padding: '6px' }}>Provider</th> */}
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Tokens (I/O/R/C)</th>
                                <th className="px-2 py-1.5 border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider text-right whitespace-nowrap" style={{ minWidth: '102px' }}>Cost</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Performance</th>
                                <th className="px-2 py-1.5 text-center border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Meta</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap">Mode</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap" style={{ maxWidth: '60px' }}>Status</th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap w-10"></th>
                                <th className="px-2 py-1.5 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider whitespace-nowrap w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={14} className="p-5 text-center">Loading...</td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="p-5 text-center">No logs found</td>
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
                                                    {new Date(log.date).toISOString()}
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
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">{log.sourceIp || '-'}
                                        </td>
                                        <td
                                            className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap"
                                            title={`Incoming: ${log.incomingApiType || '?'} → Outgoing: ${log.outgoingApiType || '?'}`}
                                            style={{ cursor: 'help' }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {log.incomingApiType === 'embeddings' ? (
                                                    <Variable size={16} className="text-green-500" />
                                                ) : log.incomingApiType === 'transcriptions' ? (
                                                    <AudioLines size={16} className="text-purple-500" />
                                                ) : log.incomingApiType === 'speech' ? (
                                                    <Volume2 size={16} className="text-orange-500" />
                                                ) : log.incomingApiType === 'images' ? (
                                                    <ImageIcon size={16} className="text-fuchsia-500" />
                                                ) : log.incomingApiType && apiLogos[log.incomingApiType] ? (
                                                    <img
                                                        src={apiLogos[log.incomingApiType]}
                                                        alt={log.incomingApiType}
                                                        style={{ width: '16px', height: '16px' }}
                                                    />
                                                ) : '?'}
                                                <span>→</span>
                                                {log.outgoingApiType === 'embeddings' ? (
                                                    <Variable size={16} className="text-green-500" />
                                                ) : log.outgoingApiType === 'transcriptions' ? (
                                                    <AudioLines size={16} className="text-purple-500" />
                                                ) : log.outgoingApiType === 'speech' ? (
                                                    <Volume2 size={16} className="text-orange-500" />
                                                ) : log.outgoingApiType === 'images' ? (
                                                    <ImageIcon size={16} className="text-fuchsia-500" />
                                                ) : log.outgoingApiType && apiLogos[log.outgoingApiType] ? (
                                                    <img
                                                        src={apiLogos[log.outgoingApiType]}
                                                        alt={log.outgoingApiType}
                                                        style={{ width: '16px', height: '16px' }}
                                                    />
                                                ) : '?'}
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
                                            title={`Input: ${formatLargeNumber(log.tokensInput || 0)} • Output: ${formatLargeNumber(log.tokensOutput || 0)} • Reasoning: ${formatLargeNumber(log.tokensReasoning || 0)} • Cached: ${formatLargeNumber(log.tokensCached || 0)}${log.tokensEstimated ? ' • * = Estimated' : ''}`}
                                            style={{ cursor: 'help' }}
                                        >
                                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                {/* Left side: Input/Output */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudUpload size={12} className="text-blue-400" />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em' }}>
                                                            {formatLargeNumber(log.tokensInput || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudDownload size={12} className="text-green-400" />
                                                        <span style={{ fontWeight: '500', fontSize: '0.9em' }}>
                                                            {formatLargeNumber(log.tokensOutput || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Right side: Reasoning/Cache */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <BrainCog size={12} className="text-purple-400" />
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                            {formatLargeNumber(log.tokensReasoning || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <PackageOpen size={12} className="text-orange-400" />
                                                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                            {formatLargeNumber(log.tokensCached || 0)}
                                                            {log.tokensEstimated ? <sup style={{ fontSize: '0.7em', opacity: 0.6 }}>*</sup> : null}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 border-b border-border-glass text-text align-middle text-right">
                                            {log.costTotal !== undefined && log.costTotal !== null ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', justifyContent: 'space-between' }}>
                                                        {log.costSource ? (
                                                            <CostToolTip source={log.costSource} costMetadata={log.costMetadata}>
                                                                <span style={{ cursor: 'help', display: 'flex', alignItems: 'center' }}>
                                                                    {log.costSource === 'simple' ? <CircleDollarSign size={14} className="text-green-400" /> :
                                                                     log.costSource === 'defined' ? <ChartCandlestick size={14} className="text-blue-400" /> :
                                                                     log.costSource === 'openrouter' ? <Globe size={14} className="text-purple-400" /> : '❔'}
                                                                </span>
                                                            </CostToolTip>
                                                        ) : <span />}
                                                        <span style={{ fontWeight: '500' }}>
                                                            {formatCost(log.costTotal)}
                                                        </span>
                                                    </div>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudUpload size={10} className="text-blue-400" /> {formatCost(log.costInput || 0)}
                                                    </span>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <CloudDownload size={10} className="text-green-400" /> {formatCost(log.costOutput || 0)}
                                                    </span>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        {(log.costCached || 0) > 0 && (
                                                            <><PackageOpen size={10} className="text-orange-400" /> {formatCost(log.costCached || 0)}</>
                                                        )}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '1.2em' }}>∅</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontWeight: '500' }}>Duration: {formatMs(log.durationMs)}</span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {log.ttftMs && log.ttftMs > 0 ? `TTFT: ${formatMs(log.ttftMs)}` : ''}
                                                </span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {log.tokensPerSec && log.tokensPerSec > 0 ? `TPS: ${formatTPS(log.tokensPerSec)}` : ''}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-center border-b border-border-glass text-text align-middle">
                                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' }}>
                                                {/* Left column: Tools and Messages */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    {/* Tools defined in request */}
                                                    {log.toolsDefined !== undefined && log.toolsDefined > 0 && (
                                                        <div title={`${log.toolsDefined} tool${log.toolsDefined > 1 ? 's' : ''} defined`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-orange-400">
                                                            <Wrench size={12} />
                                                            <span style={{ fontWeight: '500', fontSize: '0.9em' }}>{log.toolsDefined}</span>
                                                        </div>
                                                    )}
                                                    {/* Message count */}
                                                    {log.messageCount !== undefined && log.messageCount > 0 && (
                                                        <div title={`${log.messageCount} message${log.messageCount > 1 ? 's' : ''} in context`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-blue-400">
                                                            <MessagesSquare size={12} />
                                                            <span style={{ fontWeight: '500', fontSize: '0.9em' }}>{log.messageCount}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Right column: Tool calls and Finish reason */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                    {/* Tool calls in response */}
                                                    {log.toolCallsCount !== undefined && log.toolCallsCount > 0 && (
                                                        <div title={`${log.toolCallsCount} tool call${log.toolCallsCount > 1 ? 's' : ''} in response`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-green-400">
                                                            <CheckCircle2 size={12} />
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>{log.toolCallsCount}</span>
                                                        </div>
                                                    )}
                                                    {/* Finish reason - treat 'end_turn' same as 'stop' */}
                                                    {log.finishReason && (
                                                        <div title={`Finish reason: ${log.finishReason}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className="text-yellow-400">
                                                            {log.finishReason === 'stop' || log.finishReason === 'end_turn' ? <CheckCircle2 size={12} /> :
                                                             log.finishReason === 'tool_calls' ? <Wrench size={12} /> :
                                                             log.finishReason === 'length' || log.finishReason === 'max_tokens' ? <AlertTriangle size={12} /> :
                                                             <ChevronDown size={12} />}
                                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>{log.finishReason}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Parallel tool calls enabled - shown below if active */}
                                            {log.parallelToolCallsEnabled === true && (
                                                <div title="Parallel tool calling enabled" style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center', marginTop: '2px' }} className="text-purple-400">
                                                    <GitFork size={10} />
                                                    <span style={{ fontSize: '0.75em' }}>parallel</span>
                                                </div>
                                            )}
                                        </td>
                                        <td
                                            className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle"
                                            title={`${log.isStreamed ? 'Streamed' : 'Non-streamed'} • ${log.isPassthrough ? 'Direct/Passthrough' : 'Translated'}`}
                                            style={{ cursor: 'help' }}
                                        >
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                {log.isStreamed ?
                                                    <Zap size={14} className="text-blue-400" /> :
                                                    <ZapOff size={14} className="text-gray-400" />
                                                }
                                                {log.isPassthrough ?
                                                    <MoveHorizontal size={14} className="text-yellow-500" /> :
                                                    <Languages size={14} className="text-purple-400" />
                                                }
                                            </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                                            <Badge status={log.responseStatus === 'success' ? 'connected' : 'error'}>
                                                {log.responseStatus === 'success' ? '✓' : '✗'}
                                            </Badge>
                                        </td>
                                        <td className="px-2 py-1.5 text-left border-b border-border-glass text-text align-middle">
                                            <div className="flex gap-2">
                                                {log.hasDebug && (
                                                    <button
                                                        onClick={() => navigate('/debug', { state: { requestId: log.requestId } })}
                                                        className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger"
                                                        title="View Debug Trace"
                                                    >
                                                        <Bug size={14} className="text-blue-400" />
                                                    </button>
                                                )}
                                                {log.hasError && (
                                                    <button
                                                        onClick={() => navigate('/errors', { state: { requestId: log.requestId } })}
                                                        className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger"
                                                        title="View Error Details"
                                                    >
                                                        <AlertTriangle size={14} className="text-red-500" />
                                                    </button>
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
