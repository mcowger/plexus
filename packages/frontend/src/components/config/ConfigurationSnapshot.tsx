import Editor from '@monaco-editor/react';
import { AlertTriangle, Download, RefreshCw, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';

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
        <div className="bg-bg-glass/30 text-text-secondary flex h-[400px] items-center justify-center rounded-md sm:h-[500px]">
          <div className="p-6 text-center">
            <AlertTriangle className="text-warning mx-auto mb-3" size={32} />
            <p className="mb-1 text-sm font-semibold">Editor failed to load</p>
            <p className="font-body text-text-muted text-[11px]">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ConfigurationSnapshotProps {
  config: string;
  loaded: boolean;
  restarting: boolean;
  onRefresh: () => void;
  onRestart: () => void | Promise<void>;
  onExport: () => void;
}

export function ConfigurationSnapshot({
  config,
  loaded,
  restarting,
  onRefresh,
  onRestart,
  onExport,
}: ConfigurationSnapshotProps) {
  return (
    <Disclosure
      title="Configuration Snapshot"
      defaultOpen={false}
      extra={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            leftIcon={<RotateCcw size={14} />}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRestart}
            isLoading={restarting}
            leftIcon={<RefreshCw size={14} />}
          >
            Restart
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onExport}
            disabled={!loaded}
            leftIcon={<Download size={14} />}
          >
            Export JSON
          </Button>
        </div>
      }
    >
      <div className="h-[400px] overflow-hidden rounded-sm sm:h-[500px] lg:h-[600px]">
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
    </Disclosure>
  );
}
