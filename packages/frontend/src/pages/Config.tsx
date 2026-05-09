import { Component, useEffect, useRef, useState, useCallback } from 'react';
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
  Shield,
  Save,
  Timer,
  Compass,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatMinutesToMinSec } from '@plexus/shared';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { Disclosure } from '../components/ui/Disclosure';
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

interface FailoverPolicy {
  enabled: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

interface CooldownPolicy {
  initialMinutes: number;
  maxMinutes: number;
}

interface ExplorationRates {
  performanceExplorationRate: number;
  latencyExplorationRate: number;
  e2ePerformanceExplorationRate: number;
}

const DEFAULT_EXPLORATION_RATES: ExplorationRates = {
  performanceExplorationRate: 0.05,
  latencyExplorationRate: 0.05,
  e2ePerformanceExplorationRate: 0.05,
};

const DEFAULT_FAILOVER_POLICY: FailoverPolicy = {
  enabled: true,
  retryableStatusCodes: [],
  retryableErrors: [],
};

const DEFAULT_COOLDOWN_POLICY: CooldownPolicy = {
  initialMinutes: 2,
  maxMinutes: 300,
};

export const Config = () => {
  const toast = useToast();
  const [config, setConfig] = useState('');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [isFullBackupLoading, setIsFullBackupLoading] = useState(false);
  const [isRestoreLoading, setIsRestoreLoading] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Failover settings state
  const [failoverPolicy, setFailoverPolicy] = useState<FailoverPolicy>(DEFAULT_FAILOVER_POLICY);
  const [failoverLoaded, setFailoverLoaded] = useState(false);
  const [failoverSaving, setFailoverSaving] = useState(false);
  const [statusCodesText, setStatusCodesText] = useState('');
  const [errorsText, setErrorsText] = useState('');

  // Cooldown settings state
  const [cooldownPolicy, setCooldownPolicy] = useState<CooldownPolicy>(DEFAULT_COOLDOWN_POLICY);
  const [cooldownLoaded, setCooldownLoaded] = useState(false);
  const [cooldownSaving, setCooldownSaving] = useState(false);
  // Raw input strings for cooldown fields (to allow natural typing)
  const [cooldownInitialInput, setCooldownInitialInput] = useState('');
  const [cooldownMaxInput, setCooldownMaxInput] = useState('');

  // Validate cooldown input strings
  const validateCooldownInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') {
      return { valid: false, error: 'Required' };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, error: 'Invalid number' };
    }
    if (num < 0.1) {
      return { valid: false, error: 'Must be at least 0.1' };
    }
    return { valid: true, value: num };
  };

  const initialValidation = validateCooldownInput(cooldownInitialInput);
  const maxValidation = validateCooldownInput(cooldownMaxInput);
  const isCooldownValid = cooldownLoaded && initialValidation.valid && maxValidation.valid;

  // Exploration rate settings state (setter only needed, value derived from inputs)
  const [, setExplorationRates] = useState<ExplorationRates>(DEFAULT_EXPLORATION_RATES);
  const [explorationLoaded, setExplorationLoaded] = useState(false);
  const [explorationSaving, setExplorationSaving] = useState(false);
  // Raw input strings for exploration rate fields
  const [explorationPerformanceInput, setExplorationPerformanceInput] = useState('');
  const [explorationLatencyInput, setExplorationLatencyInput] = useState('');
  const [explorationE2EInput, setExplorationE2EInput] = useState('');

  // Validate exploration rate input (0 to 1)
  const validateExplorationInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') {
      return { valid: false, error: 'Required' };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, error: 'Invalid number' };
    }
    if (num < 0 || num > 1) {
      return { valid: false, error: 'Must be between 0 and 1' };
    }
    return { valid: true, value: num };
  };

  const perfValidation = validateExplorationInput(explorationPerformanceInput);
  const latValidation = validateExplorationInput(explorationLatencyInput);
  const e2eValidation = validateExplorationInput(explorationE2EInput);
  const isExplorationValid =
    explorationLoaded && perfValidation.valid && latValidation.valid && e2eValidation.valid;

  const loadFailoverPolicy = useCallback(async () => {
    try {
      const policy = await api.getFailoverPolicy();
      setFailoverPolicy(policy);
      setStatusCodesText(policy.retryableStatusCodes.join(', '));
      setErrorsText(policy.retryableErrors.join(', '));
      setFailoverLoaded(true);
    } catch (e) {
      console.error('Failed to load failover policy:', e);
      toast.error('Failed to load failover settings');
    }
  }, [toast]);

  const loadCooldownPolicy = useCallback(async () => {
    try {
      const policy = await api.getCooldownPolicy();
      setCooldownPolicy(policy);
      setCooldownInitialInput(String(policy.initialMinutes));
      setCooldownMaxInput(String(policy.maxMinutes));
      setCooldownLoaded(true);
    } catch (e) {
      console.error('Failed to load cooldown policy:', e);
      toast.error('Failed to load cooldown settings');
    }
  }, [toast]);

  const loadExplorationRates = useCallback(async () => {
    try {
      const rates = await api.getExplorationRates();
      setExplorationRates(rates);
      setExplorationPerformanceInput(String(rates.performanceExplorationRate));
      setExplorationLatencyInput(String(rates.latencyExplorationRate));
      setExplorationE2EInput(String(rates.e2ePerformanceExplorationRate));
      setExplorationLoaded(true);
    } catch (e) {
      console.error('Failed to load exploration rates:', e);
      toast.error('Failed to load exploration rate settings');
    }
  }, [toast]);

  const handleSaveFailover = async () => {
    setFailoverSaving(true);
    try {
      // Parse status codes
      const statusCodes = statusCodesText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 100 && n <= 599);

      // Parse error codes
      const retryableErrors = errorsText
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const updated = await api.patchFailoverPolicy({
        enabled: failoverPolicy.enabled,
        retryableStatusCodes: statusCodes,
        retryableErrors,
      });

      setFailoverPolicy(updated);
      setStatusCodesText(updated.retryableStatusCodes.join(', '));
      setErrorsText(updated.retryableErrors.join(', '));
      toast.success('Failover settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save failover settings');
    } finally {
      setFailoverSaving(false);
    }
  };

  const handleSaveCooldown = async () => {
    if (!initialValidation.valid || !maxValidation.valid) return;
    setCooldownSaving(true);
    try {
      const updated = await api.patchCooldownPolicy({
        initialMinutes: initialValidation.value!,
        maxMinutes: maxValidation.value!,
      });

      setCooldownPolicy(updated);
      setCooldownInitialInput(String(updated.initialMinutes));
      setCooldownMaxInput(String(updated.maxMinutes));
      toast.success('Cooldown settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save cooldown settings');
    } finally {
      setCooldownSaving(false);
    }
  };

  const handleSaveExplorationRates = async () => {
    if (!perfValidation.valid || !latValidation.valid || !e2eValidation.valid) return;
    setExplorationSaving(true);
    try {
      const updated = await api.patchExplorationRates({
        performanceExplorationRate: perfValidation.value!,
        latencyExplorationRate: latValidation.value!,
        e2ePerformanceExplorationRate: e2eValidation.value!,
      });

      setExplorationRates(updated);
      setExplorationPerformanceInput(String(updated.performanceExplorationRate));
      setExplorationLatencyInput(String(updated.latencyExplorationRate));
      setExplorationE2EInput(String(updated.e2ePerformanceExplorationRate));
      toast.success('Exploration rate settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save exploration rate settings');
    } finally {
      setExplorationSaving(false);
    }
  };

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
    loadFailoverPolicy();
    loadCooldownPolicy();
    loadExplorationRates();
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

        {/* ─── Failover Settings ──────────────────────────────────── */}
        <Disclosure
          title="Failover Settings"
          defaultOpen={false}
          extra={
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveFailover}
              isLoading={failoverSaving}
              disabled={!failoverLoaded}
              leftIcon={<Save size={14} />}
            >
              Save
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-primary" />
                <div>
                  <p className="text-sm font-medium text-text">Enable Failover</p>
                  <p className="text-xs text-text-muted">
                    When enabled, failed requests are automatically retried on the next available
                    provider.
                  </p>
                </div>
              </div>
              <Switch
                checked={failoverPolicy.enabled}
                onChange={(checked) => setFailoverPolicy((prev) => ({ ...prev, enabled: checked }))}
                aria-label="Toggle failover on/off"
              />
            </div>

            {/* Retryable Status Codes */}
            <div>
              <label
                htmlFor="retryableStatusCodes"
                className="block text-sm font-medium text-text mb-1"
              >
                Retryable Status Codes
              </label>
              <p className="text-xs text-text-muted mb-2">
                HTTP status codes that trigger a retry on the next provider. Enter comma-separated
                values (100–599). Defaults to all non-2xx codes except 413 and 422 when empty.
              </p>
              <textarea
                id="retryableStatusCodes"
                value={statusCodesText}
                onChange={(e) => setStatusCodesText(e.target.value)}
                placeholder="e.g. 429, 500, 502, 503"
                rows={3}
                className="w-full rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              />
            </div>

            {/* Retryable Errors */}
            <div>
              <label htmlFor="retryableErrors" className="block text-sm font-medium text-text mb-1">
                Retryable Network Errors
              </label>
              <p className="text-xs text-text-muted mb-2">
                Network error codes that trigger a retry on the next provider. Enter comma-separated
                values. Defaults to ECONNREFUSED, ETIMEDOUT, ENOTFOUND when empty.
              </p>
              <textarea
                id="retryableErrors"
                value={errorsText}
                onChange={(e) => setErrorsText(e.target.value)}
                placeholder="e.g. ECONNREFUSED, ETIMEDOUT, ENOTFOUND"
                rows={2}
                className="w-full rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              />
            </div>
          </div>
        </Disclosure>

        {/* ─── Cooldown Settings ──────────────────────────────────── */}
        <Disclosure
          title="Cooldown Settings"
          defaultOpen={false}
          extra={
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveCooldown}
              isLoading={cooldownSaving}
              disabled={!isCooldownValid}
              leftIcon={<Save size={14} />}
            >
              Save
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Exponential Backoff description */}
            <div className="flex items-center gap-2">
              <Timer size={16} className="text-primary" />
              <div>
                <p className="text-sm font-medium text-text">Exponential Backoff</p>
                <p className="text-xs text-text-muted">
                  When a provider fails, it is placed on cooldown using exponential backoff:{' '}
                  <code className="text-text-secondary">C(n) = min(C_max, C₀ × 2ⁿ)</code> where n is
                  the consecutive failure count.
                </p>
              </div>
            </div>

            {/* Initial Minutes */}
            <div>
              <label
                htmlFor="cooldownInitialMinutes"
                className="block text-sm font-medium text-text mb-1"
              >
                Initial Cooldown (minutes)
              </label>
              <p className="text-xs text-text-muted mb-2">
                C₀ — the cooldown duration after the first failure. Subsequent failures double the
                duration until the maximum is reached. Fractional values are supported (e.g. 0.1 = 6
                seconds).
              </p>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <input
                    id="cooldownInitialMinutes"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cooldownInitialInput}
                    onChange={(e) => setCooldownInitialInput(e.target.value)}
                    className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                  {!initialValidation.valid && cooldownInitialInput !== '' && (
                    <span className="text-xs text-warning">{initialValidation.error}</span>
                  )}
                </div>
                <span className="text-xs text-text-muted tabular-nums min-w-[60px]">
                  ={' '}
                  {initialValidation.valid && initialValidation.value !== undefined
                    ? formatMinutesToMinSec(initialValidation.value)
                    : cooldownLoaded
                      ? formatMinutesToMinSec(cooldownPolicy.initialMinutes)
                      : '—'}
                </span>
              </div>
            </div>

            {/* Max Minutes */}
            <div>
              <label
                htmlFor="cooldownMaxMinutes"
                className="block text-sm font-medium text-text mb-1"
              >
                Maximum Cooldown (minutes)
              </label>
              <p className="text-xs text-text-muted mb-2">
                C_max — the upper limit for any cooldown duration, regardless of how many
                consecutive failures have occurred. Fractional values are supported (e.g. 0.1 = 6
                seconds).
              </p>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <input
                    id="cooldownMaxMinutes"
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={cooldownMaxInput}
                    onChange={(e) => setCooldownMaxInput(e.target.value)}
                    className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                  {!maxValidation.valid && cooldownMaxInput !== '' && (
                    <span className="text-xs text-warning">{maxValidation.error}</span>
                  )}
                </div>
                <span className="text-xs text-text-muted tabular-nums min-w-[60px]">
                  ={' '}
                  {maxValidation.valid && maxValidation.value !== undefined
                    ? formatMinutesToMinSec(maxValidation.value)
                    : cooldownLoaded
                      ? formatMinutesToMinSec(cooldownPolicy.maxMinutes)
                      : '—'}
                </span>
              </div>
            </div>
          </div>
        </Disclosure>

        {/* ─── Exploration Rate Settings ────────────────────────────── */}
        <Disclosure
          title="Exploration Rate Settings"
          defaultOpen={false}
          extra={
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveExplorationRates}
              isLoading={explorationSaving}
              disabled={!isExplorationValid}
              leftIcon={<Save size={14} />}
            >
              Save
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Exploration Rate description */}
            <div className="flex items-center gap-2">
              <Compass size={16} className="text-primary" />
              <div>
                <p className="text-sm font-medium text-text">Provider Exploration</p>
                <p className="text-xs text-text-muted">
                  Exploration rate controls how often the selector picks a non-optimal provider to
                  discover better options. A value of 0 always selects the best-known provider; a
                  value of 1 picks randomly. Applies to performance, latency, and e2e_performance
                  selectors.
                </p>
              </div>
            </div>

            {/* Performance Exploration Rate */}
            <div>
              <label
                htmlFor="performanceExplorationRate"
                className="block text-sm font-medium text-text mb-1"
              >
                Performance Exploration Rate
              </label>
              <p className="text-xs text-text-muted mb-2">
                The probability of exploring a non-optimal provider when using the performance
                selector. Default: 0.05 (5%).
              </p>
              <div className="flex flex-col gap-1">
                <input
                  id="performanceExplorationRate"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explorationPerformanceInput}
                  onChange={(e) => setExplorationPerformanceInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!perfValidation.valid && explorationPerformanceInput !== '' && (
                  <span className="text-xs text-warning">{perfValidation.error}</span>
                )}
              </div>
            </div>

            {/* Latency Exploration Rate */}
            <div>
              <label
                htmlFor="latencyExplorationRate"
                className="block text-sm font-medium text-text mb-1"
              >
                Latency Exploration Rate
              </label>
              <p className="text-xs text-text-muted mb-2">
                The probability of exploring a non-optimal provider when using the latency selector.
                Defaults to the Performance Exploration Rate if not explicitly set.
              </p>
              <div className="flex flex-col gap-1">
                <input
                  id="latencyExplorationRate"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explorationLatencyInput}
                  onChange={(e) => setExplorationLatencyInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!latValidation.valid && explorationLatencyInput !== '' && (
                  <span className="text-xs text-warning">{latValidation.error}</span>
                )}
              </div>
            </div>

            {/* E2E Performance Exploration Rate */}
            <div>
              <label
                htmlFor="e2ePerformanceExplorationRate"
                className="block text-sm font-medium text-text mb-1"
              >
                E2E Performance Exploration Rate
              </label>
              <p className="text-xs text-text-muted mb-2">
                The probability of exploring any provider when using the e2e_performance selector.
                Unlike the performance selector, exploration includes all candidates (including the
                current best) to keep end-to-end metrics fresh. Defaults to the Performance
                Exploration Rate if not explicitly set.
              </p>
              <div className="flex flex-col gap-1">
                <input
                  id="e2ePerformanceExplorationRate"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explorationE2EInput}
                  onChange={(e) => setExplorationE2EInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!e2eValidation.valid && explorationE2EInput !== '' && (
                  <span className="text-xs text-warning">{e2eValidation.error}</span>
                )}
              </div>
            </div>
          </div>
        </Disclosure>

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
