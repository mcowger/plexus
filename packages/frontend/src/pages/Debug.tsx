import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import MonacoEditor from '@/components/ui/monaco-editor';
import { Copy, Trash2, Clock } from 'lucide-react';

interface DebugLog {
  id: string;
  timestamp: string;
  apiKey: string;
  sourceIp: string;
  requestData?: Record<string, unknown>;
  transformedRequest?: Record<string, unknown>;
  responseData?: Record<string, unknown>;
  transformedResponse?: Record<string, unknown>;
  snapshots?: Record<string, unknown>[];
}

export function DebugPage() {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<DebugLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchDebugLogs = async () => {
    setLoading(true);
    try {
      const response = await api.queryLogs({ type: 'trace', limit: 50 });

      if (response.entries && response.entries.length > 0) {
        const typedLogs = response.entries as unknown as DebugLog[];
        setLogs(typedLogs);
      } else {
        setLogs([]);
      }
    } catch (error) {
      console.error('Failed to fetch debug logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogDetails = async (id: string) => {
    try {
      const response = await api.getLogDetails(id);
      if (response.traces && response.traces.length > 0) {
        const trace = response.traces[0] as unknown as DebugLog;
        setSelectedLog(trace);
      }
    } catch (error) {
      console.error('Failed to fetch log details:', error);
    }
  };

  useEffect(() => {
    fetchDebugLogs();
  }, []);

  const handleDeleteLog = async () => {
    if (selectedLog) {
      try {
        await api.deleteLogs({ all: true });
        setSelectedLog(null);
        await fetchDebugLogs();
      } catch (error) {
        console.error('Failed to delete log:', error);
      }
    }
    setDeleteDialogOpen(false);
  };

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const formatContent = (data: unknown): string => {
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return data;
      }
    }
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className="p-6 space-y-6 h-[calc(100vh-100px)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Debug</h1>
          <p className="text-muted-foreground">
            Inspect request/response payloads and traces
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100%-60px)]">
        <div className="lg:col-span-1 bg-card border rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Debug Traces</span>
              <Badge variant="secondary" className="ml-auto">
                {logs.length}
              </Badge>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-muted-foreground">Loading...</div>
            ) : logs.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">No debug traces found</div>
            ) : (
              <div className="divide-y">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-4 cursor-pointer hover:bg-accent transition-colors ${
                      selectedLog?.id === log.id ? 'bg-accent' : ''
                    }`}
                    onClick={() => fetchLogDetails(log.id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm truncate">{log.id}</p>
                        <p className="text-xs text-muted-foreground">{log.apiKey}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{log.sourceIp}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border rounded-lg overflow-hidden flex flex-col">
          {selectedLog ? (
            <>
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{selectedLog.id}</h2>
                  <p className="text-sm text-muted-foreground">
                    {new Date(selectedLog.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <Accordion type="multiple" defaultValue={["request", "response"]} className="w-full">
                  {selectedLog.requestData && (
                    <AccordionItem value="request">
                      <AccordionTrigger className="hover:no-underline">
                        Raw Request
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.requestData))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.requestData)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.transformedRequest && (
                    <AccordionItem value="transformed-request">
                      <AccordionTrigger className="hover:no-underline">
                        Transformed Request
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.transformedRequest))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.transformedRequest)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.responseData && (
                    <AccordionItem value="response">
                      <AccordionTrigger className="hover:no-underline">
                        Raw Response
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.responseData))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.responseData)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.transformedResponse && (
                    <AccordionItem value="transformed-response">
                      <AccordionTrigger className="hover:no-underline">
                        Transformed Response
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.transformedResponse))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.transformedResponse)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.snapshots && selectedLog.snapshots.length > 0 && (
                    <AccordionItem value="snapshots">
                      <AccordionTrigger className="hover:no-underline">
                        Snapshots ({selectedLog.snapshots.length})
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4">
                          {selectedLog.snapshots.map((snapshot, index) => (
                            <div key={index} className="space-y-2">
                              <p className="text-sm font-medium">Snapshot {index + 1}</p>
                              <MonacoEditor
                                value={formatContent(snapshot)}
                                language="json"
                                height="200px"
                                className="rounded-md"
                                options={{ readOnly: true }}
                              />
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </div>

              <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Debug Trace</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete this debug trace?
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleDeleteLog}>
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground">
                Select a debug trace from the list to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
