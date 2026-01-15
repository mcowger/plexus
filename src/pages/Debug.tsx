import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import MonacoEditor from '@/components/ui/monaco-editor';
import { Copy, Trash2, Clock } from 'lucide-react';
import type { components } from '@/lib/management';

type DebugLog = components['schemas']['DebugTraceEntry'];

interface DebugLogListItem {
  id: string;
  timestamp: string;
}

export function DebugPage() {
  const [logs, setLogs] = useState<DebugLogListItem[]>([]);
  const [selectedLog, setSelectedLog] = useState<DebugLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const fetchDebugLogs = async () => {
    setLoading(true);
    try {
      const response = await api.queryLogs({ type: 'trace', limit: 50 });

      if (response.entries && response.entries.length > 0) {
        const typedLogs = response.entries.map((log: any) => ({
          id: log.id,
          timestamp: log.timestamp,
        })) as unknown as DebugLogListItem[];
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
      } else {
        setSelectedLog(null);
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
        await api.deleteLogById(selectedLog.id);
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

  const formatStreamChunk = (chunk: string): string => {
    // Stream chunks are raw strings, attempt to parse if they look like JSON
    if (chunk.startsWith('data: ')) {
      return chunk;
    }
    try {
      const parsed = JSON.parse(chunk);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return chunk;
    }
  };

  const renderResponseTypeBadge = (type?: 'original' | 'reconstructed') => {
    if (!type) return null;
    
    return (
      <Badge 
        variant={type === 'original' ? 'default' : 'secondary'}
        className="ml-2"
      >
        {type === 'original' ? 'Original' : 'Reconstructed'}
      </Badge>
    );
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
          <ScrollArea className="flex-1">
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
                        <p className="text-xs text-muted-foreground">Debug trace</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
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

              <ScrollArea className="flex-1">
                <div className="p-4">
                  <Accordion type="multiple" defaultValue={["client-request", "provider-request"]} className="w-full">
                  {selectedLog.clientRequest && (
                    <AccordionItem value="client-request">
                      <AccordionTrigger className="hover:no-underline">
                        Client Request
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.clientRequest))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.clientRequest)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.providerRequest && (
                    <AccordionItem value="provider-request">
                      <AccordionTrigger className="hover:no-underline">
                        Provider Request
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.providerRequest))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.providerRequest)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.providerResponse && (
                    <AccordionItem value="provider-response">
                      <AccordionTrigger className="hover:no-underline">
                        <span className="flex items-center">
                          Provider Response
                          {renderResponseTypeBadge(selectedLog.providerResponse.type)}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.providerResponse))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.providerResponse)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedLog.clientResponse && (
                    <AccordionItem value="client-response">
                      <AccordionTrigger className="hover:no-underline">
                        <span className="flex items-center">
                          Client Response
                          {renderResponseTypeBadge(selectedLog.clientResponse.type)}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedLog.clientResponse))}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedLog.clientResponse)}
                            language="json"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

              {selectedLog.providerStreamChunks && selectedLog.providerStreamChunks.length > 0 && (
            <AccordionItem value="provider-stream">
                  <AccordionTrigger className="hover:no-underline">
                  Provider Stream
             </AccordionTrigger>
                      <AccordionContent>
                <div className="space-y-2">
                     <div className="flex justify-end">
                          <Button
                       variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(selectedLog.providerStreamChunks?.map(c => c.chunk).join('') || '')}
                         >
                <Copy className="h-4 w-4 mr-2" />
                        Copy All
                            </Button>
                   </div>
                  <MonacoEditor
                         value={selectedLog.providerStreamChunks.map(c => formatStreamChunk(c.chunk)).join('\n\n---\n\n')}
                   language="json"
                         height="300px"
                 className="rounded-md"
                      options={{ readOnly: true, wordWrap: 'on' }}
                  />
                        </div>
                 </AccordionContent>
                  </AccordionItem>
                )}

              {selectedLog.clientStreamChunks && selectedLog.clientStreamChunks.length > 0 && (
           <AccordionItem value="client-stream">
          <AccordionTrigger className="hover:no-underline">
               Client Stream
        </AccordionTrigger>
                      <AccordionContent>
                     <div className="space-y-2">
                   <div className="flex justify-end">
                <Button
                           variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(selectedLog.clientStreamChunks?.map(c => c.chunk).join('') || '')}
                >
                        <Copy className="h-4 w-4 mr-2" />
                           Copy All
                            </Button>
                 </div>
             <MonacoEditor
              value={selectedLog.clientStreamChunks.map(c => formatStreamChunk(c.chunk)).join('\n')}
                    language="text"
               height="300px"
                className="rounded-md"
                        options={{ readOnly: true, wordWrap: 'on' }}
                     />
                   </div>
                    </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
                </div>
              </ScrollArea>

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
