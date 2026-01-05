import React, { useEffect, useState, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { CostToolTip } from '../components/ui/CostToolTip';
import { api, UsageRecord, formatLargeNumber } from '../lib/api';
import { ChevronLeft, ChevronRight, Search, Filter, Trash2, Bug, Zap, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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
    const uploadEmoji = "🔺"
    const downloadEmoji = "🔻"
    const cachedEmoji = "📦"
    const reasoningEmoji = "🧠"

    return (
        <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
            <div className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Logs</h1>
                    <Badge status="neutral">{total} Records</Badge>
                </div>
                <Button onClick={handleDeleteAll} variant="danger" className="flex items-center gap-2" disabled={logs.length === 0}>
                    <Trash2 size={16} />
                    Delete All
                </Button>
            </div>

            <Card className="glass-bg rounded-lg p-6 max-w-full shadow-xl overflow-hidden flex flex-col gap-4">
                <div className="mb-4">
                    <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                        <div className="relative w-[250px]">
                            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                            <Input
                                placeholder="Filter by Model..."
                                value={filters.incomingModelAlias}
                                onChange={e => setFilters({ ...filters, incomingModelAlias: e.target.value })}
                                style={{ paddingLeft: '32px' }}
                            />
                        </div>
                        <div className="relative w-[200px]">
                            <Filter size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                            <Input
                                placeholder="Filter by Provider..."
                                value={filters.provider}
                                onChange={e => setFilters({ ...filters, provider: e.target.value })}
                                style={{ paddingLeft: '32px' }}
                            />
                        </div>
                        <Button type="submit" variant="primary">Search</Button>
                    </form>
                </div>

                <div className="overflow-x-auto -mx-6 px-6">
                    <table className="w-full border-collapse font-body text-[13px]">
                        <thead>
                            <tr className="text-left border-b border-border">
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Date</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Key</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Source IP</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">API (In/Out)</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Model (In/Sel)</th>
                                {/* <th style={{ padding: '6px' }}>Provider</th> */}
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Tokens (I/O/R/C)</th>
                                <th className="px-4 py-3 border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider text-right">Cost</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Performance</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Streamed</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Direct</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">Status</th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider w-[40px]"></th>
                                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider w-[40px]"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={16} className="p-5 text-center">Loading...</td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={16} className="p-5 text-center">No logs found</td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr
                                        key={log.requestId}
                                        className={clsx("group border-b border-border-glass hover:bg-bg-hover", log.requestId === newestLogId && 'animate-pulse-fade')}
                                    >
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle whitespace-nowrap">
                                            {new Date(log.date).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">{log.apiKey || '-'}</td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">{log.sourceIp || '-'}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
                                            {log.incomingApiType || '?'}→{log.outgoingApiType || '?'}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span>{log.incomingModelAlias || '-'}</span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.9em' }}>{log.provider || '-'}:{log.selectedModelName || '-'}</span>

                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle text-center">
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                <span style={{ fontWeight: '500' }}>{uploadEmoji} {formatLargeNumber(log.tokensInput || 0)} {downloadEmoji} {formatLargeNumber(log.tokensOutput || 0)} </span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                    {cachedEmoji} {formatLargeNumber(log.tokensCached || 0)}
                                                    {reasoningEmoji} {formatLargeNumber(log.tokensReasoning || 0)}
                                                </span>
                                            </div>
                                            {/* {log.tokensInput || 0} / {log.tokensOutput || 0} / {log.tokensReasoning || 0} / {log.tokensCached || 0} */}
                                        </td>
                                        <td className="px-4 py-3 border-b border-border-glass text-text align-middle text-right">
                                            {log.costTotal !== undefined && log.costTotal !== null ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', justifyContent: 'space-between' }}>
                                                        {log.costSource ? (
                                                            <CostToolTip source={log.costSource} costMetadata={log.costMetadata}>
                                                                <span style={{ cursor: 'help', fontSize: '0.9em' }}>
                                                                    {log.costSource === 'simple' ? '⚪' : 
                                                                     log.costSource === 'defined' ? '🧩' : 
                                                                     log.costSource === 'openrouter' ? '🌐' : '❔'}
                                                                </span>
                                                            </CostToolTip>
                                                        ) : <span />}
                                                        <span style={{ fontWeight: '500' }}>
                                                            ${log.costTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                                        </span>
                                                    </div>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                        {uploadEmoji} ${(log.costInput || 0).toFixed(6)}
                                                    </span>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                        {downloadEmoji} ${(log.costOutput || 0).toFixed(6)}
                                                    </span>
                                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em' }}>
                                                        {(log.costCached || 0) > 0 && (
                                                            <>{cachedEmoji} ${log.costCached?.toFixed(6)}</>
                                                        )}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '1.2em' }}>∅</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontWeight: '500' }}>{log.durationMs > 10 ? `${(log.durationMs / 1000).toFixed(1)}s` : '∅'}</span>
                                                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                    {log.ttftMs && log.ttftMs > 0 ? `${Math.round(log.ttftMs)}ms` : ''}
                                                    {log.tokensPerSec && log.tokensPerSec > 0 ? ` • ${log.tokensPerSec.toFixed(1)}t/s` : ''}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle text-center">{log.isStreamed ? '✓' : ''}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle text-center">
                                            {log.isPassthrough ? <Zap size={14} className="text-yellow-500" /> : ''}
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
                                            <Badge status={log.responseStatus === 'success' ? 'connected' : 'error'}>
                                                {log.responseStatus === 'success' ? '✓' : '✗'}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
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
                                        <td className="px-4 py-3 text-left border-b border-border-glass text-text align-middle">
                                            <button
                                                onClick={() => handleDelete(log.requestId)}
                                                className="bg-transparent border-0 text-text-muted p-1 rounded cursor-pointer transition-all duration-200 flex items-center justify-center hover:bg-red-600/10 hover:text-danger group-hover:opacity-100 opacity-0 transition-opacity"
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
