import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import {
  RotateCcw,
  AlertTriangle,
  Download,
  Upload,
  RefreshCw,
  HardDrive,
  Archive,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import type { CardLayout } from '../types/card';
import { DEFAULT_CARD_ORDER, LAYOUT_STORAGE_KEY } from '../types/card';

class EditorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Monaco Editor failed to load:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-[400px] sm:h-[500px] flex items-center justify-center bg-bg-glass/30 text-text-secondary rounded-md">
          <div className="text-center p-6">
            <AlertTriangle className="mx-auto mb-3 text-warning" size={32} />
            <p className="text-sm font-semibold mb-1">Editor failed to load</p>
            <p className="text-xs text-text-muted">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Config = () => {
  const toast = useToast();
  const [config, setConfig] = useState('');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [isFullBackupLoading, setIsFullBackupLoading] = useState(false);
  const [isRestoreLoading, setIsRestoreLoading] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const loadConfig = async () => {
    try {
      const data = await api.getConfigExport();
      setConfig(JSON.stringify(data, null, 2));
      setIsConfigLoaded(true);
    } catch (e) {
      console.error('Failed to load config:', e);
      setIsConfigLoaded(false);
      toast.error('Failed to load config');
    }
  };

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cardLayout, setCardLayout] = useState<CardLayout>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCardLayout(parsed);
      } catch {
        console.error('Failed to parse card layout');
      }
    }
  }, []);

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportLayout = () =>
    triggerDownload(
      JSON.stringify(cardLayout, null, 2),
      'plexus-card-layout.json',
      'application/json'
    );

  const handleExportConfig = () =>
    triggerDownload(config, 'plexus-config-export.json', 'application/json');

  const handleImportLayout = () => fileInputRef.current?.click();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content) as CardLayout;

        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item.id === 'string' && typeof item.order === 'number')
        ) {
          const validIds = new Set<string>(DEFAULT_CARD_ORDER);
          const allIdsValid = parsed.every((item: { id: string }) => validIds.has(item.id));
          if (!allIdsValid) {
            toast.error('Invalid card layout: contains unknown card IDs');
            return;
          }

          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(parsed));
          setCardLayout(parsed);
          toast.success('Card layout imported');
        } else {
          toast.error('Invalid card layout format');
        }
      } catch {
        toast.error('Failed to import: Invalid JSON file');
      }
    };
    reader.readAsText(file);

    event.target.value = '';
  };

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleBackupDownload = async () => {
    setIsBackupLoading(true);
    try {
      const blob = await api.createBackup();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerBlobDownload(blob, `plexus-backup-${timestamp}.json`);
      toast.success('Config backup downloaded');
    } catch (e) {
      toast.error((e as Error).message, 'Backup failed');
    } finally {
      setIsBackupLoading(false);
    }
  };

  const handleFullBackupDownload = async () => {
    setIsFullBackupLoading(true);
    try {
      const blob = await api.createFullBackup();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      triggerBlobDownload(blob, `plexus-backup-${timestamp}.tar.gz`);
      toast.success('Full backup downloaded');
    } catch (e) {
      toast.error((e as Error).message, 'Full backup failed');
    } finally {
      setIsFullBackupLoading(false);
    }
  };

  const handleRestoreClick = () => restoreInputRef.current?.click();

  const handleRestoreFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const isArchive =
      file.name.endsWith('.tar.gz') ||
      file.name.endsWith('.tgz') ||
      file.type === 'application/gzip' ||
      file.type === 'application/x-gzip';

    const ok = await toast.confirm({
      title: 'Restore Database?',
      message:
        'This will **replace all existing data** with the contents of the backup file. This action cannot be undone. Are you sure?',
      confirmLabel: 'Restore',
      variant: 'danger',
    });
    if (!ok) return;

    setIsRestoreLoading(true);
    try {
      let result;
      if (isArchive) {
        result = await api.restoreFullBackup(file);
      } else {
        const text = await file.text();
        const data = JSON.parse(text);
        result = await api.restoreBackup(data);
      }
      toast.success(result.message, 'Restore complete');
      // Reload config after restore
      await loadConfig();
    } catch (e) {
      toast.error((e as Error).message, 'Restore failed');
    } finally {
      setIsRestoreLoading(false);
    }
  };

  const handleRestart = async () => {
    const ok = await toast.confirm({
      title: 'Restart Plexus?',
      message:
        'This will briefly interrupt all ongoing requests. Are you sure you want to continue?',
      confirmLabel: 'Restart',
      variant: 'danger',
    });
    if (!ok) return;

    setIsRestarting(true);
    try {
      await api.restart();
    } catch (e) {
      toast.error((e as Error).message, 'Restart failed');
      setIsRestarting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Configuration"
        subtitle="View current system configuration (read-only). Use the Providers, Models, and Keys pages to make changes."
      />

      <div className="flex flex-col gap-6">
        <Card
          title="Configuration Export"
          flush
          extra={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadConfig}
                leftIcon={<RotateCcw size={14} />}
              >
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRestart}
                isLoading={isRestarting}
                leftIcon={<RefreshCw size={14} />}
              >
                Restart
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportConfig}
                disabled={!isConfigLoaded}
                leftIcon={<Download size={14} />}
              >
                Export JSON
              </Button>
            </div>
          }
        >
          <div className="h-[400px] sm:h-[500px] lg:h-[600px] rounded-sm overflow-hidden">
            <EditorErrorBoundary>
              <Editor
                height="100%"
                defaultLanguage="json"
                value={config}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  fontFamily: '"Fira Code", "Fira Mono", monospace',
                }}
              />
            </EditorErrorBoundary>
          </div>
        </Card>

        <Card
          title="Backup & Restore"
          extra={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleFullBackupDownload}
                isLoading={isFullBackupLoading}
                leftIcon={<Archive size={14} />}
              >
                Full Backup
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackupDownload}
                isLoading={isBackupLoading}
                leftIcon={<HardDrive size={14} />}
              >
                Config Backup
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary mb-3">
            Back up your database or restore from a previously exported backup file.
          </p>

          <div className="p-3 bg-warning/10 border border-warning/30 rounded-md mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
              <div className="text-sm text-text-secondary">
                <p className="font-medium text-text">Backup files contain sensitive data</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  This includes API keys and OAuth tokens in plaintext. Store backup files securely.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <div className="flex-1">
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                Config Backup
              </h4>
              <p className="text-xs text-text-muted mb-2">
                Providers, models, keys, quotas, and settings only. Fast and small.
              </p>
            </div>
            <div className="flex-1">
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                Full Backup
              </h4>
              <p className="text-xs text-text-muted mb-2">
                Config plus all usage logs, debug data, and errors. May take a moment for large
                databases.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="danger"
              size="sm"
              onClick={handleRestoreClick}
              isLoading={isRestoreLoading}
              leftIcon={<Upload size={14} />}
            >
              Restore from File…
            </Button>
          </div>

          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,.tar.gz,.tgz,application/gzip,application/x-gzip,application/octet-stream"
            className="hidden"
            onChange={handleRestoreFileSelect}
          />
        </Card>

        <Card
          title="Card Layout"
          extra={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportLayout}
                leftIcon={<Download size={14} />}
              >
                Export
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleImportLayout}
                leftIcon={<Upload size={14} />}
              >
                Import
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary mb-4">
            Import or export your Live Metrics card layout configuration.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />

          <div>
            <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
              Current Card Order
            </h4>
            <div className="flex flex-wrap gap-2">
              {cardLayout.length === 0 && (
                <p className="text-xs text-text-muted italic">
                  Default layout — no customizations saved.
                </p>
              )}
              {cardLayout.map((card, index) => (
                <div
                  key={card.id}
                  className="px-3 py-1.5 bg-bg-glass rounded-md border border-border-glass text-xs text-text"
                >
                  <span className="text-text-muted mr-2">{index + 1}.</span>
                  {card.id}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
};
