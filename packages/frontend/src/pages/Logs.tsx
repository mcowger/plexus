import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { parse } from 'yaml';
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
import { Search, Trash2, ChevronLeft, ChevronRight, Bug, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface UsageLog {
  id: string;
  timestamp: string;
  apiKey: string;
  sourceIp: string;
  api: string;
  model: string;
  tokens: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  cost: number;
  performance: {
    latency: number;
    duration: number;
  };
  success: boolean;
  debug?: string;
  error?: string;
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
      setTotal(response.total);
      setHasMore(response.hasMore);
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
      const provs = (config as any).providers || [];
      const keys = (config as any).keys || [];

      const providerNames = provs.map((p: any) => p.name);
      const modelsMap: Record<string, string[]> = {};
      const keyNames = keys.map((k: any) => k.name);

      provs.forEach((p: any) => {
        modelsMap[p.name] = p.models || [];
      });

      setProviders(providerNames);
      setModels(modelsMap);
      setApiKeys(keyNames);
    } catch (error) {
      console.error('Failed to fetch config:', error);
    }
  };

  useEffect(() => {
    fetchLogs();
    fetchConfig();
  }, [page, filters]);

  const handleDeleteLog = async (id: string) => {
    try {
      // Note: API doesn't support individual delete, deleting all for now
      await api.deleteLogs({ all: true });
      setPage(0);
      await fetchLogs();
    } catch (error) {
      console.error('Failed to delete log:', error);
    }
    setDeleteDialogOpen(false);
    setLogToDelete(null);
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

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(6)}`;
  };

  const selectedProviderModels = filters.provider ? models[filters.provider] || [] : [];
  const allModels = Object.values(models).flat();

  return (
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
              {providers.map((p) => (
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
              <TableHead>Date</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Source IP</TableHead>
              <TableHead>API</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Performance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
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
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>{log.apiKey}</TableCell>
                  <TableCell className="text-muted-foreground">{log.sourceIp}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.api}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{log.model}</TableCell>
                  <TableCell>
                    {log.tokens.total !== undefined ? log.tokens.total.toLocaleString() : '-'}
                  </TableCell>
                  <TableCell>{formatCost(log.cost)}</TableCell>
                  <TableCell>{formatLatency(log.performance.latency)}</TableCell>
                  <TableCell>
                    {log.success ? (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Error
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {log.debug && (
                        <Button variant="ghost" size="sm">
                          <Bug className="h-4 w-4" />
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
                              setLogToDelete(log.id);
                              setDeleteDialogOpen(true);
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
  );
}
