import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { RotateCcw, AlertTriangle, Download, Upload, RefreshCw } from 'lucide-react';
import type { CardLayout } from '../types/card';
import { DEFAULT_CARD_ORDER, LAYOUT_STORAGE_KEY } from '../types/card';

/**
 * Error boundary specifically for the Monaco Editor component.
 */
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
        <div className="h-[500px] flex items-center justify-center bg-bg-subtle/30 text-text-secondary">
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
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const [cardLayout, setCardLayout] = useState<CardLayout>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load current card layout from localStorage
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

  const handleExportLayout = () => {
    const dataStr = JSON.stringify(cardLayout, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plexus-card-layout.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportConfig = () => {
    const blob = new Blob([config], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plexus-config-export.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import layout from JSON file
  const handleImportLayout = () => {
    fileInputRef.current?.click();
  };

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
            alert('Invalid card layout: contains unknown card IDs');
            return;
          }

          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(parsed));
          setCardLayout(parsed);
          alert('Card layout imported successfully!');
        } else {
          alert('Invalid card layout format');
        }
      } catch {
        alert('Failed to import: Invalid JSON file');
      }
    };
    reader.readAsText(file);

    event.target.value = '';
  };

  const handleRestart = async () => {
    if (
      !confirm(
        'Are you sure you want to restart Plexus? This will briefly interrupt all ongoing requests.'
      )
    ) {
      return;
    }

    setIsRestarting(true);
    try {
      await api.restart();
    } catch (e) {
      const error = e as Error;
      alert(`Restart failed:\n\n${error.message}`);
      setIsRestarting(false);
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Configuration</h1>
        <p className="text-[15px] text-text-secondary m-0">
          View current system configuration (read-only). Use the Providers, Models, and Keys pages
          to make changes.
        </p>
      </div>

      <div className="glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          <h3 className="font-heading text-lg font-semibold text-text m-0">Configuration Export</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>
        <div className="h-[500px] rounded-sm overflow-hidden">
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
                fontSize: 14,
                fontFamily: '"Fira code", "Fira Mono", monospace',
              }}
            />
          </EditorErrorBoundary>
        </div>
      </div>
      {/* Card Layout Configuration */}
      <div className="mt-8 glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          <div>
            <h3 className="font-heading text-lg font-semibold text-text m-0">Card Layout</h3>
            <p className="text-sm text-text-secondary m-0 mt-1">
              Import or export your Live Metrics card layout configuration.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
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
        </div>

        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* Current Layout Preview */}
        <div className="px-6 py-4 bg-bg-subtle/30">
          <h4 className="font-heading text-sm font-semibold text-text m-0 mb-3">
            Current Card Order
          </h4>
          <div className="flex flex-wrap gap-2">
            {cardLayout.map((card, index) => (
              <div
                key={card.id}
                className="px-3 py-1.5 bg-bg-glass rounded-md border border-border-glass text-sm text-text"
              >
                <span className="text-text-muted mr-2">{index + 1}.</span>
                {card.id}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
