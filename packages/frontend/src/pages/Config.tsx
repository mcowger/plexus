import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MonacoEditor from '@/components/ui/monaco-editor';
import { Save, RotateCcw, Check, X, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ConfigPage() {
  const [config, setConfig] = useState('');
  const [originalConfig, setOriginalConfig] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const configYaml = await api.getConfig();
      setConfig(configYaml);
      setOriginalConfig(configYaml);
      setHasChanges(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to load configuration',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    setHasChanges(config !== originalConfig);
  }, [config, originalConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateConfig(config);
      setOriginalConfig(config);
      setHasChanges(false);
      toast({
        title: 'Configuration saved',
        description: 'The configuration has been successfully updated.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to save configuration',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setSaving(false);
      setSaveDialogOpen(false);
    }
  };

  const handleReset = () => {
    setConfig(originalConfig);
    setHasChanges(false);
    toast({
      title: 'Configuration reset',
      description: 'All unsaved changes have been discarded.',
    });
    setResetDialogOpen(false);
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 h-[calc(100vh-100px)] flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
          <p className="text-muted-foreground">
            Edit the YAML configuration file directly
          </p>
        </div>
        <div className="flex items-center gap-4">
          {hasChanges && (
            <Badge variant="secondary" className="gap-1">
              Unsaved changes
            </Badge>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(true)}
              disabled={!hasChanges}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
            <Button
              onClick={() => setSaveDialogOpen(true)}
              disabled={!hasChanges || saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 border rounded-lg overflow-hidden">
        <MonacoEditor
          value={config}
          onChange={setConfig}
          language="yaml"
          theme="vs-dark"
          height="100%"
          options={{
            readOnly: false,
            minimap: { enabled: true },
            wordWrap: 'off',
            scrollBeyondLastLine: false,
          }}
        />
      </div>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Configuration</DialogTitle>
            <DialogDescription>
              Are you sure you want to save this configuration? The changes will be applied immediately with hot reload.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Configuration</DialogTitle>
            <DialogDescription>
              Are you sure you want to discard all unsaved changes? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
