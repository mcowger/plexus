import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import MonacoEditor from '@/components/ui/monaco-editor';
import { Trash2, AlertTriangle, Clock, FileText } from 'lucide-react';

interface ErrorLog {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  details?: Record<string, unknown>;
  type?: string;
}

export function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);

  const fetchErrors = async () => {
    setLoading(true);
    try {
      const response = await api.queryLogs({ type: 'error', limit: 50 });

      if (response.entries && response.entries.length > 0) {
        const typedErrors = response.entries as unknown as ErrorLog[];
        setErrors(typedErrors);
      } else {
        setErrors([]);
      }
    } catch (error) {
      console.error('Failed to fetch errors:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchErrorDetails = async (id: string) => {
    try {
      const response = await api.getLogDetails(id);
      if (response.errors && response.errors.length > 0) {
        const error = response.errors[0] as unknown as ErrorLog;
        setSelectedError(error);
      }
    } catch (error) {
      console.error('Failed to fetch error details:', error);
    }
  };

  useEffect(() => {
    fetchErrors();
  }, []);

  const handleDeleteError = async () => {
    if (selectedError) {
      try {
        await api.deleteLogs({ type: 'error', all: true });
        setSelectedError(null);
        await fetchErrors();
      } catch (error) {
        console.error('Failed to delete error:', error);
      }
    }
    setDeleteDialogOpen(false);
  };

  const handleDeleteAllErrors = async () => {
    try {
      await api.deleteLogs({ type: 'error', all: true });
      setSelectedError(null);
      await fetchErrors();
    } catch (error) {
      console.error('Failed to delete all errors:', error);
    }
    setDeleteAllDialogOpen(false);
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
          <h1 className="text-3xl font-bold tracking-tight">Errors</h1>
          <p className="text-muted-foreground">
            View and investigate error logs and stack traces
          </p>
        </div>
        <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete All
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete All Errors</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete all error logs? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteAllDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteAllErrors}>
                Delete All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100%-60px)]">
        <div className="lg:col-span-1 bg-card border rounded-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-medium">Error Logs</span>
              <Badge variant="destructive" className="ml-auto">
                {errors.length}
              </Badge>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-muted-foreground">Loading...</div>
            ) : errors.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">No errors found</div>
            ) : (
              <div className="divide-y">
                {errors.map((error) => (
                  <div
                    key={error.id}
                    className={`p-4 cursor-pointer hover:bg-accent transition-colors ${
                      selectedError?.id === error.id ? 'bg-accent' : ''
                    }`}
                    onClick={() => fetchErrorDetails(error.id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm truncate">{error.id}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {error.message}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {new Date(error.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                    {error.type && (
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {error.type}
                        </Badge>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border rounded-lg overflow-hidden flex flex-col">
          {selectedError ? (
            <>
              <div className="p-4 border-b flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="font-semibold">{selectedError.id}</h2>
                    {selectedError.type && (
                      <Badge variant="outline">{selectedError.type}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(selectedError.timestamp).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete Error Log</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to delete this error log?
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteError}>
                          Delete
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <Accordion type="multiple" defaultValue={["message", "stack"]} className="w-full">
                  <AccordionItem value="message">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Error Message
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="p-4 bg-muted rounded-md font-mono text-sm whitespace-pre-wrap">
                        {selectedError.message}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {selectedError.stack && (
                    <AccordionItem value="stack">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Stack Trace
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(selectedError.stack || '')}
                            >
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={selectedError.stack || ''}
                            language="javascript"
                            height="300px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {selectedError.details && (
                    <AccordionItem value="details">
                      <AccordionTrigger className="hover:no-underline">
                        Additional Details
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(formatContent(selectedError.details))}
                            >
                              Copy
                            </Button>
                          </div>
                          <MonacoEditor
                            value={formatContent(selectedError.details)}
                            language="json"
                            height="200px"
                            className="rounded-md"
                            options={{ readOnly: true }}
                          />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground">
                Select an error from the list to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
