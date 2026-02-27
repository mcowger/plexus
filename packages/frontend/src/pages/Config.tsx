import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Save, RotateCcw, AlertTriangle, Download, Upload } from 'lucide-react';
import type { CardLayout } from '../types/card';
import { DEFAULT_CARD_ORDER, LAYOUT_STORAGE_KEY } from '../types/card';

/**
 * Error boundary specifically for the Monaco Editor component.
 *
 * Monaco Editor (especially v0.55.1+) can crash during initialization in certain
 * browser environments. A known issue is that Monaco internally calls CSS.escape()
 * for generating scoped CSS class names, and if the polyfill in main.tsx fails to
 * load or a browser lacks support, the editor throws at mount time. Other failure
 * modes include web worker initialization failures and Content Security Policy
 * violations.
 *
 * This class component (required for React error boundaries -- hooks cannot catch
 * render errors) wraps the Monaco Editor and, if it throws during rendering or
 * mounting, displays a friendly fallback UI instead of crashing the entire Config
 * page. The error message is shown for debugging purposes.
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then(setConfig);
  }, []);

  const [validationErrors, setValidationErrors] = useState<Array<{
    path: string;
    message: string;
  }> | null>(null);
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

  /**
   * Exports the current card layout as a downloadable JSON file.
   *
   * Serializes the cardLayout state (an array of { id: CardId, order: number } objects)
   * into a pretty-printed JSON string, creates a temporary Blob URL, and triggers a
   * browser download via a dynamically created <a> element. The downloaded file is
   * named "plexus-card-layout.json".
   *
   * The Blob URL is revoked immediately after the click to prevent memory leaks.
   * This approach works across all modern browsers without requiring a backend endpoint.
   */
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

  // Import layout from JSON file
  const handleImportLayout = () => {
    fileInputRef.current?.click();
  };

  /**
   * Handles the file selection event when a user picks a JSON file for import.
   *
   * Reads the selected file as text, parses it as JSON, and runs a multi-step
   * validation pipeline before accepting the layout:
   *
   * 1. **JSON parsing**: The file content must be valid JSON. If parsing fails,
   *    the user is alerted with a generic "Invalid JSON file" message.
   *
   * 2. **Structural validation**: The parsed data must be an array where every
   *    element has a string `id` property and a numeric `order` property.
   *    This matches the CardLayout type (Array<{ id: CardId; order: number }>).
   *
   * 3. **Card ID validation**: Every `id` in the imported layout is checked
   *    against the DEFAULT_CARD_ORDER set, which is the canonical list of all
   *    known CardId values (e.g., 'velocity', 'provider', 'model', 'concurrency',
   *    etc.). This prevents importing layouts that reference cards which no
   *    longer exist or were never defined -- such stale IDs would cause rendering
   *    errors on the Live Metrics dashboard since there would be no matching
   *    component to render. The DEFAULT_CARD_ORDER array (from types/card.ts)
   *    serves as the single source of truth for valid card identifiers.
   *
   * If all validations pass, the layout is persisted to localStorage under
   * LAYOUT_STORAGE_KEY and the component state is updated to reflect the new
   * order immediately. The file input is reset so the same file can be re-imported
   * if needed.
   */
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content) as CardLayout;

        // Validate structure: must be an array of { id: string, order: number } objects
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => typeof item.id === 'string' && typeof item.order === 'number')
        ) {
          // Validate that all card IDs are recognized by checking against the
          // DEFAULT_CARD_ORDER set. This prevents importing layouts with stale or
          // unknown card IDs that would fail to render on the dashboard.
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

    // Reset the file input value so the onChange event fires even if the
    // user selects the same file again (browsers skip onChange for same-value inputs).
    event.target.value = '';
  };

  const handleSave = async () => {
    setIsSaving(true);
    setValidationErrors(null);
    try {
      await api.saveConfig(config);
    } catch (e) {
      const error = e as any;
      if (error.details && Array.isArray(error.details)) {
        // Backend validation errors
        setValidationErrors(
          error.details.map((err: any) => ({
            path: err.path?.join('.') || 'config',
            message: err.message,
          }))
        );
      } else {
        const errorMessage = error.message || 'Failed to save config';
        alert(`Save failed:\n\n${errorMessage}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Configuration</h1>
        <p className="text-[15px] text-text-secondary m-0">Edit global system configuration.</p>
      </div>

      <div className="glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          <h3 className="font-heading text-lg font-semibold text-text m-0">plexus.yaml</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                api.getConfig().then(setConfig);
                setValidationErrors(null);
              }}
              leftIcon={<RotateCcw size={14} />}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              isLoading={isSaving}
              leftIcon={<Save size={14} />}
            >
              Save Changes
            </Button>
          </div>
        </div>
        {validationErrors && validationErrors.length > 0 && (
          <div className="px-6 py-4 bg-danger/10 border-b border-danger/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-danger flex-shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <h4 className="font-heading text-sm font-semibold text-danger m-0 mb-2">
                  Configuration validation failed
                </h4>
                <ul className="m-0 pl-4 space-y-1">
                  {validationErrors.map((err, idx) => (
                    <li key={idx} className="text-sm text-danger/90 font-mono">
                      <span className="font-semibold">{err.path}:</span> {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
        <div className="h-[500px] rounded-sm overflow-hidden">
          <EditorErrorBoundary>
            <Editor
              height="100%"
              defaultLanguage="yaml"
              value={config}
              theme="vs-dark"
              onChange={(value) => setConfig(value || '')}
              options={{
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
