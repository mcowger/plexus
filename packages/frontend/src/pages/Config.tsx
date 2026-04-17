import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import { RotateCcw, AlertTriangle, Download, Upload, RefreshCw } from 'lucide-react';
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
