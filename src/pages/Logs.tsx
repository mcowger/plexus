import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { parse } from 'yaml';
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, Trash2, ChevronLeft, ChevronRight, Info, AlertTriangle, CheckCircle, XCircle, Loader2, ArrowLeftRight, Languages, CircleStop } from 'lucide-react';
import chatIcon from '@/assets/chat.svg';
import messagesIcon from '@/assets/messages.svg';
import geminiIcon from '@/assets/gemini.svg';
import { useTheme } from '@/components/theme-provider';

const activeSSEConnections = new Set<AbortController>();

interface UsageLog {
  id?: string;
  timestamp?: string;
  clientIp?: string;
  apiKey?: string;
  apiType?: string; // Incoming API format
  targetApiType?: string; // Provider's API format
  aliasUsed?: string;
  actualProvider?: string;
  actualModel?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  cost?: {
    totalCost?: number;
  };
  metrics?: {
    durationMs?: number;
    providerTtftMs?: number;
    providerTokensPerSecond?: number;
    clientTtftMs?: number;
    clientTokensPerSecond?: number;
    transformationOverheadMs?: number;
  };
  success?: boolean;
  pending?: boolean; // True for in-flight requests
  updated?: boolean; // True when this is an update to an existing log entry
  debug?: string;
  error?: string;
  isNew?: boolean; // For animation tracking
  isUpdating?: boolean; // For pulse animation
}

interface StateResponse {
  providers: { name: string; models: string[] }[];
}

export function LogsPage() {
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    model: '',
    provider: '',
    apiKey: '',
    success: '' as '' | 'true' | 'false',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logDetails, setLogDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const { theme } = useTheme();

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await api.queryLogs({
        type: 'usage',
        limit: 50,
        offset: page * 50,
        model: filters.model || undefined,
        apiKey: filters.apiKey || undefined,
        success: filters.success === '' ? undefined : filters.success === 'true',
      });

      if (response.entries && response.entries.length > 0) {
        const typedLogs = response.entries as unknown as UsageLog[];
        setLogs(typedLogs);
      } else {
        setLogs([]);
      }
      setTotal(response.total ?? 0);
      setHasMore(response.hasMore ?? false);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const configYaml = await api.getConfig();
      const config = parse(configYaml);
      const provs = (config as any)?.providers || [];
      const keys = (config as any)?.keys || [];

      const providerNames = provs.filter((p: any) => p && p.name).map((p: any) => p.name);
      const modelsMap: Record<string, string[]> = {};
      const keyNames = keys.filter((k: any) => k && k.name).map((k: any) => k.name);

      provs.forEach((p: any) => {
        if (p && p.name) {
          modelsMap[p.name] = Array.isArray(p.models) ? p.models : [];
        }
      });

      setProviders(providerNames);
      setModels(modelsMap);
      setApiKeys(keyNames);
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  const handleShowDebug = async (id?: string) => {
    if (!id) return;
    console.log('[Debug] Opening debug dialog for log:', id);
    setSelectedLogId(id);
    setDetailsLoading(true);
    setDebugDialogOpen(true);
    try {
      const details = await api.getLogDetails(id);
      console.log('[Debug] Received details:', details);
      setLogDetails(details);
    } catch (error) {
      console.error('[Debug] Failed to fetch log details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDeleteLog = async (id?: string) => {
    if (!id) return;
    try {
      await api.deleteLogById(id);
      setPage(0);
      await fetchLogs();
    } catch (error) {
      console.error('Failed to delete log:', error);
    }
    setDeleteDialogOpen(false);
    setLogToDelete(null);
  };

  const handleForceComplete = async (id?: string) => {
    if (!id) return;
    try {
      await api.forceCompleteLog(id);
      setPage(0);
      await fetchLogs();
    } catch (error) {
      console.error('Failed to force complete log:', error);
    }
  };

  const handleDeleteAllLogs = async () => {
    try {
      await api.deleteLogs({ type: 'usage', all: true });
      setPage(0);
      await fetchLogs();
    } catch (error) {
      console.error('Failed to delete all logs:', error);
    }
    setDeleteAllDialogOpen(false);
  };

  const formatLatency = (ms?: number) => {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatCost = (cost?: number | string) => {
    if (cost === undefined || cost === null) return '-';
    const numCost = typeof cost === 'string' ? parseFloat(cost) : cost;
    if (isNaN(numCost)) return '-';
    return `$${numCost.toFixed(6)}`;
  };

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return { time: '-', date: '' };
    try {
      const date = new Date(timestamp);
      const time = date.toLocaleTimeString();
      const dateStr = date.toLocaleDateString();
      return { time, date: dateStr };
    } catch {
      return { time: '-', date: '' };
    }
  };

  const safeText = (value?: string) => value || '-';

  const getApiIcon = (apiType?: string) => {
    switch (apiType) {
      case 'chat':
        return chatIcon;
      case 'messages':
        return messagesIcon;
      case 'gemini':
        return geminiIcon;
      default:
        return null;
    }
  };

  const renderApiIcon = (apiType?: string) => {
    const icon = getApiIcon(apiType);
    if (!icon) return null;
    return (
      <img 
        src={icon} 
        alt={apiType} 
        className="w-4 h-4" 
        style={{ filter: (apiType === 'chat' && theme === 'light') ? 'invert(1)' : 'none' }}
      />
    );
  };

  const selectedProviderModels = filters.provider ? models[filters.provider] || [] : [];
  const allModels = Object.values(models).flat();
  const fetchLogsRef = useRef<(() => Promise<void>) | null>(null);

  // Clear animation flags after animations complete
  useEffect(() => {
    const timer = setTimeout(() => {
      setLogs(prevLogs => 
        prevLogs.map(log => ({
          ...log,
          isNew: false,
          isUpdating: false
        }))
      );
    }, 1000); // Clear flags after 1 second

    return () => clearTimeout(timer);
  }, [logs]);

  fetchLogsRef.current = fetchLogs;

  useEffect(() => {
    fetchLogs();
    fetchConfig();
  }, [page, filters.model, filters.provider, filters.apiKey, filters.success]);

  useEffect(() => {
    if (activeSSEConnections.size > 0) {
      console.log('[SSE] Connection already exists, skipping', { totalConnections: activeSSEConnections.size });
      return;
    }

    const adminKey = localStorage.getItem('plexus_admin_key');
    const abortController = new AbortController();

    activeSSEConnections.add(abortController);
    console.log('[SSE] Connecting...', { totalConnections: activeSSEConnections.size });

    fetchEventSource('/v0/events', {
      method: 'GET',
      signal: abortController.signal,
      headers: {
        'Authorization': adminKey ? `Bearer ${adminKey}` : '',
      },
      async onopen(response) {
        console.log('[SSE] Connection opened', { status: response.status, contentType: response.headers.get('content-type') });
        if (response.ok && response.headers.get('content-type') === EventStreamContentType) {
          return;
        }
        throw new Error('SSE connection failed');
      },
      onmessage(msg) {
        if (!msg.data) return;
        try {
          const data = JSON.parse(msg.data);
          
if (data.type === 'usage') {
            console.log('[SSE] Usage event received', data);
            // Append new entry instead of refetching all logs
            setLogs(prevLogs => {
              // The SSE data is now the complete UsageLog object
              const newLog = data.data as UsageLog;
              
              // Ensure we have a valid log with an ID
              if (!newLog || !newLog.id) {
                console.log('[SSE] Invalid log entry received', newLog);
                return prevLogs;
              }
              
              // Check if this is an update event
              if (newLog.updated) {
                // Replace existing log entry completely with pulse animation
                return prevLogs.map(log => 
                  log.id === newLog.id ? { ...newLog, isUpdating: true } : log
                );
              } else {
                // Check if log already exists to avoid duplicates
                const exists = prevLogs.some(log => log.id === newLog.id);
                if (exists) return prevLogs;
                
                // Add new log to the beginning (newest first) with slide-in animation
                const updatedLogs = [{ ...newLog, isNew: true }, ...prevLogs];
                // Keep only the most recent 100 entries to prevent memory issues
                return updatedLogs.slice(0, 100);
              }
            });
            
            // Only increment total for new entries, not updates
            if (!data.data?.updated) {
              setTotal(prev => prev + 1);
            }
          } else if (data.type === 'heartbeat') {
            console.log('[SSE] Heartbeat', new Date().toISOString());
          }
        } catch (error) {
          console.log('[SSE] Parse error', { error, data: msg.data });
        }
      },
      onerror(err) {
        console.log('[SSE] Error', err);
      },
    }).catch((err) => {
      console.log('[SSE] Connection failed', err);
    });

    return () => {
      console.log('[SSE] Cleanup', { totalConnections: activeSSEConnections.size });
      abortController.abort();
      activeSSEConnections.delete(abortController);
    };
  }, []);

  return (
    <>
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
          <p className="text-muted-foreground">
            View and manage request logs with filtering and real-time updates
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All Logs
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete All Logs</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete all usage logs? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteAllDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteAllLogs}>
                  Delete All
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              placeholder="Filter by model..."
              value={filters.model}
              onChange={(e) => {
                setFilters({ ...filters, model: e.target.value });
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Provider</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={filters.provider}
              onChange={(e) => {
                setFilters({ ...filters, provider: e.target.value, model: '' });
                setPage(0);
              }}
            >
              <option value="">All Providers</option>
              {providers.filter(Boolean).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              placeholder="Filter by API key..."
              value={filters.apiKey}
              onChange={(e) => {
                setFilters({ ...filters, apiKey: e.target.value });
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={filters.success}
              onChange={(e) => {
                setFilters({ ...filters, success: e.target.value as '' | 'true' | 'false' });
                setPage(0);
              }}
            >
              <option value="">All Status</option>
              <option value="true">Success</option>
              <option value="false">Error</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Date</TableHead>
              <TableHead className="whitespace-nowrap">Key</TableHead>
              <TableHead className="whitespace-nowrap">Source IP</TableHead>
              <TableHead className="whitespace-nowrap">API</TableHead>
              <TableHead className="whitespace-nowrap">Model</TableHead>
              <TableHead className="whitespace-nowrap">Tokens</TableHead>
              <TableHead className="whitespace-nowrap">Cost</TableHead>
              <TableHead className="whitespace-nowrap">TTFT</TableHead>
              <TableHead className="whitespace-nowrap w-32 min-w-32">Status</TableHead>
              <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8">
                  Loading logs...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-8">
                  No logs found
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow 
                  key={log.id || Math.random()} 
                  className={cn(
                    log.pending ? 'opacity-60' : '',
                    log.isNew ? 'animate-slide-in' : '',
                    log.isUpdating ? 'animate-single-pulse' : ''
                  )}
                >
                  <TableCell className="whitespace-nowrap">
                    {(() => {
                      const { time, date } = formatTimestamp(log.timestamp);
                      return (
                        <div className="flex flex-col">
                          <span>{time}</span>
                          {date && <span className="text-xs text-muted-foreground">{date}</span>}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{safeText(log.apiKey)}</TableCell>
                  <TableCell className="text-muted-foreground">{safeText(log.clientIp)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {renderApiIcon(log.apiType)}
                      {log.apiType === log.targetApiType ? (
                        <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <Languages className="w-3 h-3 text-muted-foreground" />
                      )}
                      {renderApiIcon(log.targetApiType)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="font-medium">{safeText(log.aliasUsed)}</span>
                      {log.aliasUsed !== log.actualModel && (
                        <span className="text-xs text-muted-foreground">{safeText(log.actualModel)}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {log.pending ? (
                      <span className="text-muted-foreground italic flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        pending...
                      </span>
                    ) : log.usage?.totalTokens !== undefined ? (
                      log.usage.totalTokens.toLocaleString()
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {log.pending ? (
                      <span className="text-muted-foreground italic flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        pending...
                      </span>
                    ) : (
                      formatCost(log.cost?.totalCost)
                    )}
                  </TableCell>
                  <TableCell>{formatLatency(log.metrics?.durationMs)}</TableCell>
                  <TableCell className="w-32 min-w-32">
                    {log.pending ? (
                      <Badge variant="secondary" className="gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        In Progress
                      </Badge>
                    ) : log.success === true ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Success
                      </Badge>
                    ) : log.success === false ? (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Error
                      </Badge>
                    ) : (
                      <Badge variant="outline">Unknown</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
<Button
                         variant="ghost"
                         size="sm"
                         onClick={() => {
                           if (log.id) {
                             handleShowDebug(log.id);
                           }
                         }}
                       >
                         <Info className="h-4 w-4" />
                       </Button>
                      {log.pending && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (log.id) {
                              handleForceComplete(log.id);
                            }
                          }}
                        >
                          <CircleStop className="h-4 w-4 text-orange-500" />
                        </Button>
                      )}
                      {log.error && (
                        <Button variant="ghost" size="sm">
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      )}
                      <Dialog open={deleteDialogOpen && logToDelete === log.id} onOpenChange={(open) => {
                        setDeleteDialogOpen(open);
                        if (!open) setLogToDelete(null);
                      }}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (log.id) {
                                setLogToDelete(log.id);
                                setDeleteDialogOpen(true);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Log Entry</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete this log entry?
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => {
                              setDeleteDialogOpen(false);
                              setLogToDelete(null);
                            }}>
                              Cancel
                            </Button>
                            <Button variant="destructive" onClick={() => logToDelete && handleDeleteLog(logToDelete)}>
                              Delete
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {logs.length} of {total} entries
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={!hasMore || loading}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>

    <Dialog open={debugDialogOpen} onOpenChange={setDebugDialogOpen}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Log Details</DialogTitle>
          <DialogDescription>
            Request ID: {selectedLogId}
          </DialogDescription>
        </DialogHeader>
        {detailsLoading ? (
          <div className="flex items-center justify-center py-8">
            Loading log details...
          </div>
        ) : !logDetails ? (
          <div className="flex items-center justify-center py-8">
            No log details available
          </div>
        ) : (
          <div className="space-y-4">
            {logDetails.usage && (
              <div className="bg-muted p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Usage Info</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <strong>API:</strong>
                    <div className="flex items-center gap-1">
                      {renderApiIcon(logDetails.usage.apiType)}
                      {logDetails.usage.apiType === logDetails.usage.targetApiType ? (
                        <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <Languages className="w-3 h-3 text-muted-foreground" />
                      )}
                      {renderApiIcon(logDetails.usage.targetApiType)}
                    </div>
                    <span className="text-muted-foreground">({logDetails.usage.apiType} → {logDetails.usage.targetApiType})</span>
                  </div>
                  <div><strong>Model:</strong> {logDetails.usage.actualModel}</div>
                  <div><strong>Provider:</strong> {logDetails.usage.actualProvider}</div>
                  <div><strong>Alias:</strong> {logDetails.usage.aliasUsed}</div>
                  <div><strong>Duration:</strong> {formatLatency(logDetails.usage.metrics?.durationMs)}</div>
                  <div><strong>Provider TTFT:</strong> {formatLatency(logDetails.usage.metrics?.providerTtftMs)}</div>
                  <div><strong>Provider Tokens/sec:</strong> {logDetails.usage.metrics?.providerTokensPerSecond?.toFixed(2) || 'N/A'}</div>
                  <div><strong>Client TTFT:</strong> {formatLatency(logDetails.usage.metrics?.clientTtftMs)}</div>
                  <div><strong>Client Tokens/sec:</strong> {logDetails.usage.metrics?.clientTokensPerSecond?.toFixed(2) || 'N/A'}</div>
                  <div><strong>Transform Overhead:</strong> {formatLatency(logDetails.usage.metrics?.transformationOverheadMs)}</div>
                  <div><strong>Total Cost:</strong> {formatCost(logDetails.usage.cost?.totalCost)}</div>
                  <div><strong>Input Tokens:</strong> {logDetails.usage.usage?.inputTokens}</div>
                  <div><strong>Output Tokens:</strong> {logDetails.usage.usage?.outputTokens}</div>
                  <div><strong>Total Tokens:</strong> {logDetails.usage.usage?.totalTokens}</div>
                  <div><strong>Streaming:</strong> {logDetails.usage.streaming ? 'Yes' : 'No'}</div>
                </div>
              </div>
            )}

            

            {logDetails.errors && logDetails.errors.length > 0 && (
              <div className="bg-destructive/10 p-4 rounded-lg">
                <h3 className="font-semibold mb-2 text-destructive">Errors</h3>
                {logDetails.errors.map((error: any, index: number) => (
                  <div key={index} className="text-sm">
                    <pre className="bg-background p-2 rounded text-xs overflow-auto">
                      {JSON.stringify(error, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setDebugDialogOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
