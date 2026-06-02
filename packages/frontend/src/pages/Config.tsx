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
  Radar,
  Network,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatMinutesToMinSec } from '@plexus/shared';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { Disclosure } from '../components/ui/Disclosure';
import { TagSelect } from '../components/ui/TagSelect';
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
            <p className="font-body text-[11px] text-text-muted">{this.state.error.message}</p>
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

interface BackgroundExplorationConfig {
  enabled: boolean;
  stalenessThresholdSeconds: number;
  workerConcurrency: number;
}

interface TimeoutConfig {
  defaultSeconds: number;
}

interface StallConfig {
  ttfbSeconds: number | null;
  ttfbBytes: number;
  minBytesPerSecond: number | null;
  windowSeconds: number;
  gracePeriodSeconds: number;
}

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultSeconds: 300,
};

const DEFAULT_STALL_CONFIG: StallConfig = {
  ttfbSeconds: null,
  ttfbBytes: 100,
  minBytesPerSecond: null,
  windowSeconds: 10,
  gracePeriodSeconds: 30,
};

const DEFAULT_BACKGROUND_EXPLORATION: BackgroundExplorationConfig = {
  enabled: false,
  stalenessThresholdSeconds: 600,
  workerConcurrency: 2,
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
  const [isResetLogsLoading, setIsResetLogsLoading] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Failover settings state
  const [failoverPolicy, setFailoverPolicy] = useState<FailoverPolicy>(DEFAULT_FAILOVER_POLICY);
  const [failoverLoaded, setFailoverLoaded] = useState(false);
  const [failoverSaving, setFailoverSaving] = useState(false);
  const [statusCodesText, setStatusCodesText] = useState('');
  const [errorsText, setErrorsText] = useState('');

  // Trusted proxies (which immediate peers' forwarding headers are believed)
  const [trustedProxies, setTrustedProxies] = useState<string[]>([]);
  const [trustedProxiesLoaded, setTrustedProxiesLoaded] = useState(false);
  const [trustedProxiesSaving, setTrustedProxiesSaving] = useState(false);

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

  // Timeout settings state
  const [timeoutConfig, setTimeoutConfig] = useState<TimeoutConfig>(DEFAULT_TIMEOUT_CONFIG);
  const [timeoutLoaded, setTimeoutLoaded] = useState(false);
  const [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutDefaultInput, setTimeoutDefaultInput] = useState('');

  // Stall detection settings state
  const [_stallConfig, setStallConfig] = useState<StallConfig>(DEFAULT_STALL_CONFIG);
  const [stallLoaded, setStallLoaded] = useState(false);
  const [stallSaving, setStallSaving] = useState(false);
  const [stallTtfbInput, setStallTtfbInput] = useState('');
  const [stallTtfbBytesInput, setStallTtfbBytesInput] = useState('');
  const [stallMinBpsInput, setStallMinBpsInput] = useState('');
  const [stallWindowInput, setStallWindowInput] = useState('');
  const [stallGraceInput, setStallGraceInput] = useState('');

  // Validate timeout input
  const validateTimeoutInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') {
      return { valid: false, error: 'Required' };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: 'Must be an integer' };
    }
    if (num < 1) {
      return { valid: false, error: 'Must be at least 1' };
    }
    if (num > 3600) {
      return { valid: false, error: 'Must be at most 3600' };
    }
    return { valid: true, value: num };
  };

  const timeoutDefaultValidation = validateTimeoutInput(timeoutDefaultInput);
  const isTimeoutValid = timeoutLoaded && timeoutDefaultValidation.valid;

  // Validate stall detection inputs
  const validateStallInput = (
    raw: string,
    min: number,
    max: number,
    allowNull: boolean = false
  ): { valid: boolean; value?: number | null; error?: string } => {
    if (raw === '') {
      if (allowNull) return { valid: true, value: null };
      return { valid: true }; // Empty for non-nullable fields means "use default" / unchanged
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) return { valid: false, error: 'Must be a number' };
    if (!Number.isInteger(num)) return { valid: false, error: 'Must be an integer' };
    if (num < min) return { valid: false, error: `Must be at least ${min}` };
    if (num > max) return { valid: false, error: `Must be at most ${max}` };
    return { valid: true, value: num };
  };

  const stallTtfbValidation = validateStallInput(stallTtfbInput, 5, 120, true);
  const stallTtfbBytesValidation = validateStallInput(stallTtfbBytesInput, 50, 10000, false);
  const stallMinBpsValidation = validateStallInput(stallMinBpsInput, 50, 5000, true);
  const stallWindowValidation = validateStallInput(stallWindowInput, 3, 30, false);
  const stallGraceValidation = validateStallInput(stallGraceInput, 0, 120, false);
  const isStallValid =
    stallLoaded &&
    stallTtfbValidation.valid &&
    stallTtfbBytesValidation.valid &&
    stallMinBpsValidation.valid &&
    stallWindowValidation.valid &&
    stallGraceValidation.valid;

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
  const inlineRatesValid =
    explorationLoaded && perfValidation.valid && latValidation.valid && e2eValidation.valid;

  // Background exploration settings state
  const [bgExploration, setBgExploration] = useState<BackgroundExplorationConfig>(
    DEFAULT_BACKGROUND_EXPLORATION
  );
  const [bgExplorationLoaded, setBgExplorationLoaded] = useState(false);
  const [bgExplorationSaving, setBgExplorationSaving] = useState(false);
  const [bgStalenessInput, setBgStalenessInput] = useState('');
  const [bgConcurrencyInput, setBgConcurrencyInput] = useState('');

  const validateStalenessInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') return { valid: false, error: 'Required' };
    const num = Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: 'Must be an integer (seconds)' };
    }
    if (num < 1) return { valid: false, error: 'Must be at least 1 second' };
    return { valid: true, value: num };
  };

  const validateConcurrencyInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') return { valid: false, error: 'Required' };
    const num = Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: 'Must be an integer' };
    }
    if (num < 1 || num > 16) return { valid: false, error: 'Must be between 1 and 16' };
    return { valid: true, value: num };
  };

  const stalenessValidation = validateStalenessInput(bgStalenessInput);
  const concurrencyValidation = validateConcurrencyInput(bgConcurrencyInput);
  const bgFieldsValid =
    bgExplorationLoaded && stalenessValidation.valid && concurrencyValidation.valid;

  // When background exploration is enabled, inline rate inputs are ignored at
  // runtime, so we don't gate Save on their validation. When disabled, the
  // background tunables still need to be valid (they're just dormant).
  const isExplorationValid = bgExploration.enabled
    ? bgFieldsValid
    : inlineRatesValid && bgFieldsValid;

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

  const loadTrustedProxies = useCallback(async () => {
    try {
      const result = await api.getTrustedProxies();
      setTrustedProxies(result.trustedProxies);
      setTrustedProxiesLoaded(true);
    } catch (e) {
      console.error('Failed to load trusted proxies:', e);
      toast.error('Failed to load trusted proxies');
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

  const loadBackgroundExploration = useCallback(async () => {
    try {
      const cfg = await api.getBackgroundExploration();
      setBgExploration(cfg);
      setBgStalenessInput(String(cfg.stalenessThresholdSeconds));
      setBgConcurrencyInput(String(cfg.workerConcurrency));
      setBgExplorationLoaded(true);
    } catch (e) {
      console.error('Failed to load background exploration settings:', e);
      toast.error('Failed to load background exploration settings');
    }
  }, [toast]);

  const loadTimeoutConfig = useCallback(async () => {
    try {
      const cfg = await api.getTimeoutConfig();
      setTimeoutConfig(cfg);
      setTimeoutDefaultInput(String(cfg.defaultSeconds));
      setTimeoutLoaded(true);
    } catch (e) {
      console.error('Failed to load timeout config:', e);
      toast.error('Failed to load timeout settings');
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

  const handleSaveTrustedProxies = async () => {
    setTrustedProxiesSaving(true);
    try {
      const result = await api.patchTrustedProxies(trustedProxies);
      setTrustedProxies(result.trustedProxies);
      toast.success('Trusted proxies saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save trusted proxies');
    } finally {
      setTrustedProxiesSaving(false);
    }
  };

  const loadStallConfig = useCallback(async () => {
    try {
      const cfg = await api.getStallConfig();
      setStallConfig(cfg);
      setStallTtfbInput(cfg.ttfbSeconds != null ? String(cfg.ttfbSeconds) : '');
      setStallTtfbBytesInput(String(cfg.ttfbBytes));
      setStallMinBpsInput(cfg.minBytesPerSecond != null ? String(cfg.minBytesPerSecond) : '');
      setStallWindowInput(String(cfg.windowSeconds));
      setStallGraceInput(String(cfg.gracePeriodSeconds));
      setStallLoaded(true);
    } catch (e) {
      console.error('Failed to load stall config:', e);
      toast.error('Failed to load stall detection settings');
    }
  }, [toast]);

  const handleSaveTimeout = async () => {
    if (!timeoutDefaultValidation.valid) return;
    setTimeoutSaving(true);
    try {
      const updated = await api.patchTimeoutConfig({
        defaultSeconds: timeoutDefaultValidation.value!,
      });

      setTimeoutConfig(updated);
      setTimeoutDefaultInput(String(updated.defaultSeconds));
      toast.success('Timeout settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save timeout settings');
    } finally {
      setTimeoutSaving(false);
    }
  };

  const handleSaveStall = async () => {
    setStallSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (stallTtfbInput === '') {
        updates.ttfbSeconds = null;
      } else if (stallTtfbValidation.valid && stallTtfbValidation.value !== undefined) {
        updates.ttfbSeconds = stallTtfbValidation.value;
      }
      if (
        stallTtfbBytesInput !== '' &&
        stallTtfbBytesValidation.valid &&
        stallTtfbBytesValidation.value !== undefined
      ) {
        updates.ttfbBytes = stallTtfbBytesValidation.value;
      }
      if (stallMinBpsInput === '') {
        updates.minBytesPerSecond = null;
      } else if (stallMinBpsValidation.valid && stallMinBpsValidation.value !== undefined) {
        updates.minBytesPerSecond = stallMinBpsValidation.value;
      }
      if (
        stallWindowInput !== '' &&
        stallWindowValidation.valid &&
        stallWindowValidation.value !== undefined
      ) {
        updates.windowSeconds = stallWindowValidation.value;
      }
      if (
        stallGraceInput !== '' &&
        stallGraceValidation.valid &&
        stallGraceValidation.value !== undefined
      ) {
        updates.gracePeriodSeconds = stallGraceValidation.value;
      }

      const updated = await api.patchStallConfig(updates);
      setStallConfig(updated);
      setStallTtfbInput(updated.ttfbSeconds != null ? String(updated.ttfbSeconds) : '');
      setStallTtfbBytesInput(String(updated.ttfbBytes));
      setStallMinBpsInput(
        updated.minBytesPerSecond != null ? String(updated.minBytesPerSecond) : ''
      );
      setStallWindowInput(String(updated.windowSeconds));
      setStallGraceInput(String(updated.gracePeriodSeconds));
      toast.success('Stall detection settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save stall detection settings');
    } finally {
      setStallSaving(false);
    }
  };

  const handleSaveExploration = async () => {
    if (!stalenessValidation.valid || !concurrencyValidation.valid) return;
    // Inline rates only need to validate when background mode is off; when it
    // is on, the rates aren't consulted at runtime.
    if (
      !bgExploration.enabled &&
      (!perfValidation.valid || !latValidation.valid || !e2eValidation.valid)
    ) {
      return;
    }
    setExplorationSaving(true);
    setBgExplorationSaving(true);
    try {
      const tasks: Promise<unknown>[] = [
        api.patchBackgroundExploration({
          enabled: bgExploration.enabled,
          stalenessThresholdSeconds: stalenessValidation.value!,
          workerConcurrency: concurrencyValidation.value!,
        }),
      ];
      // Only persist inline rates when their inputs are valid. Skipping when
      // background mode is on (and rates may be untouched) avoids overwriting
      // stored values with stale strings.
      if (perfValidation.valid && latValidation.valid && e2eValidation.valid) {
        tasks.push(
          api.patchExplorationRates({
            performanceExplorationRate: perfValidation.value!,
            latencyExplorationRate: latValidation.value!,
            e2ePerformanceExplorationRate: e2eValidation.value!,
          })
        );
      }
      const results = await Promise.all(tasks);
      const updatedBg = results[0] as Awaited<ReturnType<typeof api.patchBackgroundExploration>>;
      const updatedRates = results[1] as
        | Awaited<ReturnType<typeof api.patchExplorationRates>>
        | undefined;

      setBgExploration(updatedBg);
      setBgStalenessInput(String(updatedBg.stalenessThresholdSeconds));
      setBgConcurrencyInput(String(updatedBg.workerConcurrency));

      if (updatedRates) {
        setExplorationRates(updatedRates);
        setExplorationPerformanceInput(String(updatedRates.performanceExplorationRate));
        setExplorationLatencyInput(String(updatedRates.latencyExplorationRate));
        setExplorationE2EInput(String(updatedRates.e2ePerformanceExplorationRate));
      }

      toast.success('Exploration settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save exploration settings');
    } finally {
      setExplorationSaving(false);
      setBgExplorationSaving(false);
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
    loadTrustedProxies();
    loadTimeoutConfig();
    loadStallConfig();
    loadExplorationRates();
    loadBackgroundExploration();
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

  const handleResetLogs = async () => {
    const ok = await toast.confirm({
      title: 'Reset All Logs?',
      message:
        'This will **permanently delete all request logs, error logs, and debug trace logs**. Configuration, cooldowns, and settings will not be touched. This action cannot be undone. Are you sure?',
      confirmLabel: 'Reset Logs',
      variant: 'danger',
    });
    if (!ok) return;

    setIsResetLogsLoading(true);
    try {
      const res = await api.resetLogs();
      toast.success(res.message || 'All logs have been reset successfully');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to reset logs');
    } finally {
      setIsResetLogsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Configuration"
        subtitle="View current system configuration (read-only). Use the Providers, Models, and Keys pages to make changes."
      />

      <PageContainer>
        <div className="flex flex-col gap-6">
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
            <div className="flex flex-col gap-3">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-primary" />
                  <div>
                    <p className="font-body text-[12px] font-medium text-text">Enable Failover</p>
                    <p className="font-body text-[11px] text-text-muted">
                      When enabled, failed requests are automatically retried on the next available
                      provider.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={failoverPolicy.enabled}
                  onChange={(checked) =>
                    setFailoverPolicy((prev) => ({ ...prev, enabled: checked }))
                  }
                  aria-label="Toggle failover on/off"
                />
              </div>

              {/* Retryable Status Codes */}
              <div>
                <label
                  htmlFor="retryableStatusCodes"
                  className="font-body text-[12px] font-medium text-text"
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
                  className="w-full py-1 px-2 font-mono text-[12px] text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted resize-y"
                />
              </div>

              {/* Retryable Errors */}
              <div>
                <label
                  htmlFor="retryableErrors"
                  className="font-body text-[12px] font-medium text-text"
                >
                  Retryable Network Errors
                </label>
                <p className="text-xs text-text-muted mb-2">
                  Network error codes that trigger a retry on the next provider. Enter
                  comma-separated values. Defaults to ECONNREFUSED, ETIMEDOUT, ENOTFOUND when empty.
                </p>
                <textarea
                  id="retryableErrors"
                  value={errorsText}
                  onChange={(e) => setErrorsText(e.target.value)}
                  placeholder="e.g. ECONNREFUSED, ETIMEDOUT, ENOTFOUND"
                  rows={2}
                  className="w-full py-1 px-2 font-mono text-[12px] text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted resize-y"
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
            <div className="flex flex-col gap-3">
              {/* Initial + Max in 2-col grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="cooldownInitialMinutes"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    Initial Cooldown (min){' '}
                    <span className="text-text-muted font-normal">— C₀, first failure</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="cooldownInitialMinutes"
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={cooldownInitialInput}
                      onChange={(e) => setCooldownInitialInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">
                      {initialValidation.valid && initialValidation.value !== undefined
                        ? formatMinutesToMinSec(initialValidation.value)
                        : cooldownLoaded
                          ? formatMinutesToMinSec(cooldownPolicy.initialMinutes)
                          : '—'}
                    </span>
                  </div>
                  {!initialValidation.valid && cooldownInitialInput !== '' && (
                    <span className="text-[11px] text-warning">{initialValidation.error}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="cooldownMaxMinutes"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    Maximum Cooldown (min){' '}
                    <span className="text-text-muted font-normal">— C_max, upper limit</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="cooldownMaxMinutes"
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={cooldownMaxInput}
                      onChange={(e) => setCooldownMaxInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">
                      {maxValidation.valid && maxValidation.value !== undefined
                        ? formatMinutesToMinSec(maxValidation.value)
                        : cooldownLoaded
                          ? formatMinutesToMinSec(cooldownPolicy.maxMinutes)
                          : '—'}
                    </span>
                  </div>
                  {!maxValidation.valid && cooldownMaxInput !== '' && (
                    <span className="text-[11px] text-warning">{maxValidation.error}</span>
                  )}
                </div>
              </div>
            </div>
          </Disclosure>

          {/* ─── Timeout Settings ───────────────────────────────────── */}
          <Disclosure
            title="Timeout Settings"
            defaultOpen={false}
            extra={
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveTimeout}
                isLoading={timeoutSaving}
                disabled={!isTimeoutValid}
                leftIcon={<Save size={14} />}
              >
                Save
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="timeoutDefaultSeconds"
                  className="font-body text-[12px] font-medium text-text"
                >
                  Default Timeout (seconds){' '}
                  <span className="text-text-muted font-normal">— global default, 1–3600s</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="timeoutDefaultSeconds"
                    type="number"
                    min={1}
                    max={3600}
                    step={1}
                    value={timeoutDefaultInput}
                    onChange={(e) => setTimeoutDefaultInput(e.target.value)}
                    className="w-48 h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {timeoutDefaultValidation.valid && timeoutDefaultValidation.value !== undefined
                      ? timeoutDefaultValidation.value >= 60
                        ? `${Math.floor(timeoutDefaultValidation.value / 60)}m ${timeoutDefaultValidation.value % 60}s`
                        : `${timeoutDefaultValidation.value}s`
                      : timeoutLoaded
                        ? timeoutConfig.defaultSeconds >= 60
                          ? `${Math.floor(timeoutConfig.defaultSeconds / 60)}m ${timeoutConfig.defaultSeconds % 60}s`
                          : `${timeoutConfig.defaultSeconds}s`
                        : '—'}
                  </span>
                </div>
                {!timeoutDefaultValidation.valid && timeoutDefaultInput !== '' && (
                  <span className="text-[11px] text-warning">{timeoutDefaultValidation.error}</span>
                )}
              </div>
            </div>
          </Disclosure>

          {/* ─── Stall Detection Settings ────────────────────────────── */}
          <Disclosure
            title="Stall Detection"
            defaultOpen={false}
            extra={
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveStall}
                isLoading={stallSaving}
                disabled={!isStallValid}
                leftIcon={<Save size={14} />}
              >
                Save
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="stallTtfbSeconds"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    TTFB Timeout (s){' '}
                    <span className="text-text-muted font-normal">— 5–120, empty = off</span>
                  </label>
                  <input
                    id="stallTtfbSeconds"
                    type="number"
                    min={5}
                    max={120}
                    step={1}
                    placeholder="Disabled"
                    value={stallTtfbInput}
                    onChange={(e) => setStallTtfbInput(e.target.value)}
                    className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  {!stallTtfbValidation.valid && stallTtfbInput !== '' && (
                    <span className="text-[11px] text-warning">{stallTtfbValidation.error}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="stallTtfbBytes"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    TTFB Byte Threshold{' '}
                    <span className="text-text-muted font-normal">— 50–10,000</span>
                  </label>
                  <input
                    id="stallTtfbBytes"
                    type="number"
                    min={50}
                    max={10000}
                    step={1}
                    value={stallTtfbBytesInput}
                    onChange={(e) => setStallTtfbBytesInput(e.target.value)}
                    className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  {!stallTtfbBytesValidation.valid && stallTtfbBytesInput !== '' && (
                    <span className="text-[11px] text-warning">
                      {stallTtfbBytesValidation.error}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="stallMinBps"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    Min Bytes/sec{' '}
                    <span className="text-text-muted font-normal">— 50–5,000, empty = off</span>
                  </label>
                  <input
                    id="stallMinBps"
                    type="number"
                    min={50}
                    max={5000}
                    step={1}
                    placeholder="Disabled"
                    value={stallMinBpsInput}
                    onChange={(e) => setStallMinBpsInput(e.target.value)}
                    className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  {!stallMinBpsValidation.valid && stallMinBpsInput !== '' && (
                    <span className="text-[11px] text-warning">{stallMinBpsValidation.error}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="stallWindowSeconds"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    Sliding Window (s) <span className="text-text-muted font-normal">— 3–30</span>
                  </label>
                  <input
                    id="stallWindowSeconds"
                    type="number"
                    min={3}
                    max={30}
                    step={1}
                    value={stallWindowInput}
                    onChange={(e) => setStallWindowInput(e.target.value)}
                    className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  {!stallWindowValidation.valid && stallWindowInput !== '' && (
                    <span className="text-[11px] text-warning">{stallWindowValidation.error}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="stallGraceSeconds"
                    className="font-body text-[12px] font-medium text-text"
                  >
                    Grace Period (s){' '}
                    <span className="text-text-muted font-normal">— 0–120, post-TTFB pause</span>
                  </label>
                  <input
                    id="stallGraceSeconds"
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={stallGraceInput}
                    onChange={(e) => setStallGraceInput(e.target.value)}
                    className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                  />
                  {!stallGraceValidation.valid && stallGraceInput !== '' && (
                    <span className="text-[11px] text-warning">{stallGraceValidation.error}</span>
                  )}
                </div>
              </div>
            </div>
          </Disclosure>

          {/* ─── Exploration Settings (inline rates + background mode) ───── */}
          <Disclosure
            title="Exploration Settings"
            defaultOpen={false}
            extra={
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveExploration}
                isLoading={explorationSaving || bgExplorationSaving}
                disabled={!isExplorationValid}
                leftIcon={<Save size={14} />}
              >
                Save
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {/* Background exploration: master toggle */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Radar size={16} className="text-primary" />
                  <div>
                    <p className="font-body text-[12px] font-medium text-text">
                      Background Exploration
                    </p>
                    <p className="font-body text-[11px] text-text-muted">
                      Fire background probe requests instead of diverting live traffic. Probes use
                      apiKey="probe".
                    </p>
                  </div>
                </div>
                <Switch
                  checked={bgExploration.enabled}
                  onChange={(checked) =>
                    setBgExploration((prev) => ({ ...prev, enabled: checked }))
                  }
                  aria-label="Toggle background exploration on/off"
                />
              </div>

              {/* Background tunables — only rendered when background mode is on */}
              {bgExploration.enabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="bgExplorationStaleness"
                      className="font-body text-[12px] font-medium text-text"
                    >
                      Staleness Threshold (s){' '}
                      <span className="text-text-muted font-normal">— min 1, default 600</span>
                    </label>
                    <input
                      id="bgExplorationStaleness"
                      type="number"
                      min={1}
                      step={1}
                      value={bgStalenessInput}
                      onChange={(e) => setBgStalenessInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    {!stalenessValidation.valid && bgStalenessInput !== '' && (
                      <span className="text-[11px] text-warning">{stalenessValidation.error}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="bgExplorationConcurrency"
                      className="font-body text-[12px] font-medium text-text"
                    >
                      Worker Concurrency{' '}
                      <span className="text-text-muted font-normal">— 1–16, default 2</span>
                    </label>
                    <input
                      id="bgExplorationConcurrency"
                      type="number"
                      min={1}
                      max={16}
                      step={1}
                      value={bgConcurrencyInput}
                      onChange={(e) => setBgConcurrencyInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    {!concurrencyValidation.valid && bgConcurrencyInput !== '' && (
                      <span className="text-[11px] text-warning">
                        {concurrencyValidation.error}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Inline rate tunables — only rendered when background mode is off */}
              {!bgExploration.enabled && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="performanceExplorationRate"
                      className="font-body text-[12px] font-medium text-text"
                    >
                      Performance Rate{' '}
                      <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
                    </label>
                    <input
                      id="performanceExplorationRate"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={explorationPerformanceInput}
                      onChange={(e) => setExplorationPerformanceInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    {!perfValidation.valid && explorationPerformanceInput !== '' && (
                      <span className="text-[11px] text-warning">{perfValidation.error}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="latencyExplorationRate"
                      className="font-body text-[12px] font-medium text-text"
                    >
                      Latency Rate{' '}
                      <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
                    </label>
                    <input
                      id="latencyExplorationRate"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={explorationLatencyInput}
                      onChange={(e) => setExplorationLatencyInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    {!latValidation.valid && explorationLatencyInput !== '' && (
                      <span className="text-[11px] text-warning">{latValidation.error}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="e2ePerformanceExplorationRate"
                      className="font-body text-[12px] font-medium text-text"
                    >
                      E2E Rate{' '}
                      <span className="text-text-muted font-normal">— 0–1, default 0.05</span>
                    </label>
                    <input
                      id="e2ePerformanceExplorationRate"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={explorationE2EInput}
                      onChange={(e) => setExplorationE2EInput(e.target.value)}
                      className="w-full h-[27px] py-0 px-2 font-mono text-[12px] leading-none text-text bg-bg-subtle border border-border-glass rounded-sm outline-none focus:border-primary placeholder:text-text-muted"
                    />
                    {!e2eValidation.valid && explorationE2EInput !== '' && (
                      <span className="text-[11px] text-warning">{e2eValidation.error}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Disclosure>

          {/* ─── Network / Trusted Proxies ──────────────────────────── */}
          <Disclosure
            title="Network Settings"
            defaultOpen={false}
            extra={
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveTrustedProxies}
                isLoading={trustedProxiesSaving}
                disabled={!trustedProxiesLoaded}
                leftIcon={<Save size={14} />}
              >
                Save
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-primary" />
                <div>
                  <p className="font-body text-[12px] font-medium text-text">Trusted Proxies</p>
                  <p className="font-body text-[11px] text-text-muted">
                    IPs/CIDRs of reverse proxies whose forwarding headers (X-Forwarded-For,
                    CF-Connecting-IP, …) are believed when resolving a client&apos;s IP. Requests
                    arriving directly from any other address use their real connection IP instead,
                    so spoofed headers cannot defeat per-key IP allowlists.
                  </p>
                </div>
              </div>

              <div>
                <TagSelect
                  label="Trusted Proxy IPs"
                  placeholder="e.g. 10.0.0.0/8  172.16.0.0/12  192.168.1.5"
                  options={[]}
                  selected={trustedProxies}
                  allowCustom
                  splitOnSpace
                  onChange={setTrustedProxies}
                />
                <p className="text-xs text-text-muted mt-2">
                  Type entries separated by spaces. The default trust-all list is{' '}
                  <code>0.0.0.0/0</code> plus <code>::/0</code> — keep this only if Plexus is not
                  publicly reachable except through your proxy. An empty list trusts no proxies.
                  Accepts IPv4/IPv6, CIDR, and ranges.
                </p>
              </div>
            </div>
          </Disclosure>

          <Card title="Backup & Restore">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 mr-1">
                <AlertTriangle size={13} className="text-warning shrink-0" />
                <span className="font-body text-[11px] text-text-muted">
                  Sensitive data — store securely
                </span>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={handleRestoreClick}
                isLoading={isRestoreLoading}
                leftIcon={<Upload size={14} />}
              >
                Restore
              </Button>
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
              <Button
                variant="danger"
                size="sm"
                onClick={handleResetLogs}
                isLoading={isResetLogsLoading}
                leftIcon={<Trash2 size={14} />}
              >
                Reset All Logs
              </Button>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".json,.tar.gz,.tgz,application/gzip,application/x-gzip,application/octet-stream"
                className="hidden"
                onChange={handleRestoreFileSelect}
              />
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

          {/* ─── Configuration Snapshot ─────────────────────────────── */}
          <Disclosure
            title="Configuration Snapshot"
            defaultOpen={false}
            extra={
              <div className="flex items-center gap-2">
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
          </Disclosure>
        </div>
      </PageContainer>
    </div>
  );
};
