import { Component, useEffect, useRef, useState, useCallback } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  Radar,
  Activity,
} from 'lucide-react';
import i18n from '../i18n';
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
            <p className="text-sm font-semibold mb-1">{i18n.t('config.editorFailedToLoad')}</p>
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
  const { t } = useTranslation();
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
      return { valid: false, error: t('config.validation.required') };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, error: t('config.validation.invalidNumber') };
    }
    if (num < 0.1) {
      return { valid: false, error: t('config.validation.mustBeAtLeast', { min: 0.1 }) };
    }
    return { valid: true, value: num };
  };

  // Timeout settings state
  const [timeoutConfig, setTimeoutConfig] = useState<TimeoutConfig>(DEFAULT_TIMEOUT_CONFIG);
  const [timeoutLoaded, setTimeoutLoaded] = useState(false);
  const [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutDefaultInput, setTimeoutDefaultInput] = useState('');

  // Stall detection settings state
  const [stallConfig, setStallConfig] = useState<StallConfig>(DEFAULT_STALL_CONFIG);
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
      return { valid: false, error: t('config.validation.required') };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: t('config.validation.mustBeInteger') };
    }
    if (num < 1) {
      return { valid: false, error: t('config.validation.mustBeAtLeast', { min: 1 }) };
    }
    if (num > 3600) {
      return { valid: false, error: t('config.validation.mustBeAtMost', { max: 3600 }) };
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
    if (!Number.isFinite(num)) return { valid: false, error: t('config.validation.mustBeNumber') };
    if (!Number.isInteger(num))
      return { valid: false, error: t('config.validation.mustBeInteger') };
    if (num < min) return { valid: false, error: t('config.validation.mustBeAtLeast', { min }) };
    if (num > max) return { valid: false, error: t('config.validation.mustBeAtMost', { max }) };
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
      return { valid: false, error: t('config.validation.required') };
    }
    const num = Number(raw);
    if (isNaN(num) || !isFinite(num)) {
      return { valid: false, error: t('config.validation.invalidNumber') };
    }
    if (num < 0 || num > 1) {
      return { valid: false, error: t('config.validation.mustBeBetween', { min: 0, max: 1 }) };
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
    if (raw === '') return { valid: false, error: t('config.validation.required') };
    const num = Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: t('config.validation.mustBeIntegerSeconds') };
    }
    if (num < 1) return { valid: false, error: t('config.validation.mustBeAtLeastOneSecond') };
    return { valid: true, value: num };
  };

  const validateConcurrencyInput = (
    raw: string
  ): { valid: boolean; value?: number; error?: string } => {
    if (raw === '') return { valid: false, error: t('config.validation.required') };
    const num = Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      return { valid: false, error: t('config.validation.mustBeInteger') };
    }
    if (num < 1 || num > 16)
      return { valid: false, error: t('config.validation.mustBeBetween', { min: 1, max: 16 }) };
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
      toast.error(t('config.failover.toast.loadFailed'));
    }
  }, [toast, t]);

  const loadCooldownPolicy = useCallback(async () => {
    try {
      const policy = await api.getCooldownPolicy();
      setCooldownPolicy(policy);
      setCooldownInitialInput(String(policy.initialMinutes));
      setCooldownMaxInput(String(policy.maxMinutes));
      setCooldownLoaded(true);
    } catch (e) {
      console.error('Failed to load cooldown policy:', e);
      toast.error(t('config.cooldown.toast.loadFailed'));
    }
  }, [toast, t]);

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
      toast.error(t('config.exploration.toast.ratesLoadFailed'));
    }
  }, [toast, t]);

  const loadBackgroundExploration = useCallback(async () => {
    try {
      const cfg = await api.getBackgroundExploration();
      setBgExploration(cfg);
      setBgStalenessInput(String(cfg.stalenessThresholdSeconds));
      setBgConcurrencyInput(String(cfg.workerConcurrency));
      setBgExplorationLoaded(true);
    } catch (e) {
      console.error('Failed to load background exploration settings:', e);
      toast.error(t('config.exploration.toast.backgroundLoadFailed'));
    }
  }, [toast, t]);

  const loadTimeoutConfig = useCallback(async () => {
    try {
      const cfg = await api.getTimeoutConfig();
      setTimeoutConfig(cfg);
      setTimeoutDefaultInput(String(cfg.defaultSeconds));
      setTimeoutLoaded(true);
    } catch (e) {
      console.error('Failed to load timeout config:', e);
      toast.error(t('config.timeout.toast.loadFailed'));
    }
  }, [toast, t]);

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
      toast.success(t('config.failover.toast.saved'));
    } catch (e) {
      toast.error((e as Error).message, t('config.failover.toast.saveFailed'));
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
      toast.success(t('config.cooldown.toast.saved'));
    } catch (e) {
      toast.error((e as Error).message, t('config.cooldown.toast.saveFailed'));
    } finally {
      setCooldownSaving(false);
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
      toast.error(t('config.stall.toast.loadFailed'));
    }
  }, [toast, t]);

  const handleSaveTimeout = async () => {
    if (!timeoutDefaultValidation.valid) return;
    setTimeoutSaving(true);
    try {
      const updated = await api.patchTimeoutConfig({
        defaultSeconds: timeoutDefaultValidation.value!,
      });

      setTimeoutConfig(updated);
      setTimeoutDefaultInput(String(updated.defaultSeconds));
      toast.success(t('config.timeout.toast.saved'));
    } catch (e) {
      toast.error((e as Error).message, t('config.timeout.toast.saveFailed'));
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
      toast.success(t('config.stall.toast.saved'));
    } catch (e) {
      toast.error((e as Error).message, t('config.stall.toast.saveFailed'));
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

      toast.success(t('config.exploration.toast.saved'));
    } catch (e) {
      toast.error((e as Error).message, t('config.exploration.toast.saveFailed'));
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
      toast.error(t('config.configToast.loadFailed'));
    }
  };

  useEffect(() => {
    loadConfig();
    loadFailoverPolicy();
    loadCooldownPolicy();
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
            toast.error(t('config.cardLayout.toast.invalidIds'));
            return;
          }

          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(parsed));
          setCardLayout(parsed);
          toast.success(t('config.cardLayout.toast.imported'));
        } else {
          toast.error(t('config.cardLayout.toast.invalidFormat'));
        }
      } catch {
        toast.error(t('config.cardLayout.toast.invalidJson'));
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
      toast.success(t('config.backup.toast.configBackupDownloaded'));
    } catch (e) {
      toast.error((e as Error).message, t('config.backup.toast.configBackupFailed'));
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
      toast.success(t('config.backup.toast.fullBackupDownloaded'));
    } catch (e) {
      toast.error((e as Error).message, t('config.backup.toast.fullBackupFailed'));
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
      title: t('config.backup.restorePrompt.title'),
      message: t('config.backup.restorePrompt.message'),
      confirmLabel: t('config.backup.restorePrompt.confirmLabel'),
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
      toast.success(result.message, t('config.backup.toast.restoreComplete'));
      // Reload config after restore
      await loadConfig();
    } catch (e) {
      toast.error((e as Error).message, t('config.backup.toast.restoreFailed'));
    } finally {
      setIsRestoreLoading(false);
    }
  };

  const handleRestart = async () => {
    const ok = await toast.confirm({
      title: t('config.restart.title'),
      message: t('config.restart.message'),
      confirmLabel: t('config.restart.confirmLabel'),
      variant: 'danger',
    });
    if (!ok) return;

    setIsRestarting(true);
    try {
      await api.restart();
    } catch (e) {
      toast.error((e as Error).message, t('config.restart.toast.failed'));
      setIsRestarting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t('config.title')} subtitle={t('config.subtitle')} />

      <div className="flex flex-col gap-6">
        <Card
          title={t('config.export.cardTitle')}
          flush
          extra={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadConfig}
                leftIcon={<RotateCcw size={14} />}
              >
                {t('config.export.refresh')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRestart}
                isLoading={isRestarting}
                leftIcon={<RefreshCw size={14} />}
              >
                {t('config.export.restart')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExportConfig}
                disabled={!isConfigLoaded}
                leftIcon={<Download size={14} />}
              >
                {t('config.export.exportJson')}
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
          title={t('config.failover.title')}
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
              {t('common.save')}
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-primary" />
                <div>
                  <p className="text-sm font-medium text-text">{t('config.failover.enable')}</p>
                  <p className="text-xs text-text-muted">{t('config.failover.enableDesc')}</p>
                </div>
              </div>
              <Switch
                checked={failoverPolicy.enabled}
                onChange={(checked) => setFailoverPolicy((prev) => ({ ...prev, enabled: checked }))}
                aria-label={t('config.failover.toggleAriaLabel')}
              />
            </div>

            {/* Retryable Status Codes */}
            <div>
              <label
                htmlFor="retryableStatusCodes"
                className="block text-sm font-medium text-text mb-1"
              >
                {t('config.failover.statusCodes')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.failover.statusCodesDesc')}</p>
              <textarea
                id="retryableStatusCodes"
                value={statusCodesText}
                onChange={(e) => setStatusCodesText(e.target.value)}
                placeholder={t('config.failover.statusCodesPlaceholder')}
                rows={3}
                className="w-full rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              />
            </div>

            {/* Retryable Errors */}
            <div>
              <label htmlFor="retryableErrors" className="block text-sm font-medium text-text mb-1">
                {t('config.failover.errors')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.failover.errorsDesc')}</p>
              <textarea
                id="retryableErrors"
                value={errorsText}
                onChange={(e) => setErrorsText(e.target.value)}
                placeholder={t('config.failover.errorsPlaceholder')}
                rows={2}
                className="w-full rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-y"
              />
            </div>
          </div>
        </Disclosure>

        {/* ─── Cooldown Settings ──────────────────────────────────── */}
        <Disclosure
          title={t('config.cooldown.title')}
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
              {t('common.save')}
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Exponential Backoff description */}
            <div className="flex items-center gap-2">
              <Timer size={16} className="text-primary" />
              <div>
                <p className="text-sm font-medium text-text">
                  {t('config.cooldown.exponentialBackoff')}
                </p>
                <p className="text-xs text-text-muted">
                  <Trans
                    i18nKey="config.cooldown.exponentialBackoffDesc"
                    components={{ 1: <code className="text-text-secondary" /> }}
                  />
                </p>
              </div>
            </div>

            {/* Initial Minutes */}
            <div>
              <label
                htmlFor="cooldownInitialMinutes"
                className="block text-sm font-medium text-text mb-1"
              >
                {t('config.cooldown.initial')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.cooldown.initialDesc')}</p>
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
          <div className="flex flex-col gap-5">
            {/* Description */}
            <div className="flex items-start gap-2">
              <Timer size={16} className="text-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text">Upstream Request Timeout</p>
                <p className="text-xs text-text-muted">
                  The maximum time Plexus waits for an upstream provider to respond before aborting
                  the request. Can be overridden per-provider in the provider's advanced settings.
                </p>
              </div>
            </div>

            {/* Default Seconds */}
            <div>
              <label
                htmlFor="timeoutDefaultSeconds"
                className="block text-sm font-medium text-text mb-1"
              >
                Default Timeout (seconds)
              </label>
              <p className="text-xs text-text-muted mb-2">
                The global default for all upstream requests. Must be between 1 and 3600 seconds.
                When a provider-specific timeout is set, it overrides this value.
              </p>
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <input
                    id="timeoutDefaultSeconds"
                    type="number"
                    min={1}
                    max={3600}
                    step={1}
                    value={timeoutDefaultInput}
                    onChange={(e) => setTimeoutDefaultInput(e.target.value)}
                    className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  />
                  {!timeoutDefaultValidation.valid && timeoutDefaultInput !== '' && (
                    <span className="text-xs text-warning">{timeoutDefaultValidation.error}</span>
                  )}
                </div>
                <span className="text-xs text-text-muted tabular-nums min-w-[60px]">
                  {timeoutDefaultValidation.valid && timeoutDefaultValidation.value !== undefined
                    ? timeoutDefaultValidation.value >= 60
                      ? `${Math.floor(timeoutDefaultValidation.value / 60)}m ${timeoutDefaultValidation.value % 60}s`
                      : `${timeoutDefaultValidation.value}s`
                    : timeoutLoaded
                      ? timeoutConfig.defaultSeconds >= 60
                        ? `${Math.floor(timeoutConfig.defaultSeconds / 60)}m ${timeoutConfig.defaultSeconds % 60}s`
                        : `${timeoutConfig.defaultSeconds}s`
                      : '\u2014'}
                </span>
              </div>
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
          <div className="flex flex-col gap-5">
            {/* Description */}
            <div className="flex items-start gap-2">
              <Activity size={16} className="text-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text">Stream Stall Detection</p>
                <p className="text-xs text-text-muted">
                  Detect when an upstream provider is taking too long to start responding (TTFB
                  stall) or is producing data too slowly (throughput stall). When a stall is
                  detected, the request is aborted so the client can retry with a different
                  provider. Leave TTFB seconds and min bytes/sec empty to disable each dimension
                  independently.
                </p>
                {stallLoaded && (
                  <p className="text-xs text-text-muted mt-1">
                    Status:{' '}
                    {stallConfig.ttfbSeconds != null || stallConfig.minBytesPerSecond != null
                      ? 'Enabled'
                      : 'Disabled (no thresholds set)'}
                  </p>
                )}
              </div>
            </div>

            {/* TTFB Seconds */}
            <div>
              <label
                htmlFor="stallTtfbSeconds"
                className="block text-sm font-medium text-text mb-1"
              >
                TTFB Timeout (seconds)
              </label>
              <p className="text-xs text-text-muted mb-2">
                Time allowed for the provider to start producing meaningful output. Leave empty to
                disable TTFB stall detection. Must be between 5 and 120 seconds.
              </p>
              <div className="flex flex-col gap-1">
                <input
                  id="stallTtfbSeconds"
                  type="number"
                  min={5}
                  max={120}
                  step={1}
                  placeholder="Disabled"
                  value={stallTtfbInput}
                  onChange={(e) => setStallTtfbInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!stallTtfbValidation.valid && stallTtfbInput !== '' && (
                  <span className="text-xs text-warning">{stallTtfbValidation.error}</span>
                )}
              </div>
            </div>

            {/* TTFB Bytes */}
            <div>
              <label htmlFor="stallTtfbBytes" className="block text-sm font-medium text-text mb-1">
                {t('config.stall.ttfbBytes')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.stall.ttfbBytesDesc')}</p>
              <div className="flex flex-col gap-1">
                <input
                  id="stallTtfbBytes"
                  type="number"
                  min={50}
                  max={10000}
                  step={1}
                  value={stallTtfbBytesInput}
                  onChange={(e) => setStallTtfbBytesInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!stallTtfbBytesValidation.valid && stallTtfbBytesInput !== '' && (
                  <span className="text-xs text-warning">{stallTtfbBytesValidation.error}</span>
                )}
              </div>
            </div>

            {/* Min Bytes Per Second */}
            <div>
              <label htmlFor="stallMinBps" className="block text-sm font-medium text-text mb-1">
                {t('config.stall.minBps')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.stall.minBpsDesc')}</p>
              <div className="flex flex-col gap-1">
                <input
                  id="stallMinBps"
                  type="number"
                  min={50}
                  max={5000}
                  step={1}
                  placeholder={t('config.stall.disabledPlaceholder')}
                  value={stallMinBpsInput}
                  onChange={(e) => setStallMinBpsInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!stallMinBpsValidation.valid && stallMinBpsInput !== '' && (
                  <span className="text-xs text-warning">{stallMinBpsValidation.error}</span>
                )}
              </div>
            </div>

            {/* Window Seconds */}
            <div>
              <label
                htmlFor="stallWindowSeconds"
                className="block text-sm font-medium text-text mb-1"
              >
                {t('config.stall.windowSeconds')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.stall.windowSecondsDesc')}</p>
              <div className="flex flex-col gap-1">
                <input
                  id="stallWindowSeconds"
                  type="number"
                  min={3}
                  max={30}
                  step={1}
                  value={stallWindowInput}
                  onChange={(e) => setStallWindowInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!stallWindowValidation.valid && stallWindowInput !== '' && (
                  <span className="text-xs text-warning">{stallWindowValidation.error}</span>
                )}
              </div>
            </div>

            {/* Grace Period Seconds */}
            <div>
              <label
                htmlFor="stallGraceSeconds"
                className="block text-sm font-medium text-text mb-1"
              >
                {t('config.stall.graceSeconds')}
              </label>
              <p className="text-xs text-text-muted mb-2">{t('config.stall.graceSecondsDesc')}</p>
              <div className="flex flex-col gap-1">
                <input
                  id="stallGraceSeconds"
                  type="number"
                  min={0}
                  max={120}
                  step={1}
                  value={stallGraceInput}
                  onChange={(e) => setStallGraceInput(e.target.value)}
                  className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                />
                {!stallGraceValidation.valid && stallGraceInput !== '' && (
                  <span className="text-xs text-warning">{stallGraceValidation.error}</span>
                )}
              </div>
            </div>
          </div>
        </Disclosure>

        {/* ─── Exploration Settings (inline rates + background mode) ───── */}
        <Disclosure
          title={t('config.exploration.title')}
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
              {t('common.save')}
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            {/* Description */}
            <div className="flex items-start gap-2">
              <Compass size={16} className="text-primary mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text">{t('config.exploration.heading')}</p>
                <p className="text-xs text-text-muted">{t('config.exploration.headingDesc')}</p>
              </div>
            </div>

            {/* Background exploration: master toggle */}
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-bg-glass/40 p-3">
              <div className="flex items-start gap-2">
                <Radar size={16} className="text-primary mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-text">
                    {t('config.exploration.background')}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t('config.exploration.backgroundDesc')}
                  </p>
                </div>
              </div>
              <Switch
                checked={bgExploration.enabled}
                onChange={(checked) => setBgExploration((prev) => ({ ...prev, enabled: checked }))}
                aria-label={t('config.exploration.backgroundAriaLabel')}
              />
            </div>

            {/* Background tunables — only rendered when background mode is on */}
            {bgExploration.enabled && (
              <div className="flex flex-col gap-5">
                <div>
                  <label
                    htmlFor="bgExplorationStaleness"
                    className="block text-sm font-medium text-text mb-1"
                  >
                    {t('config.exploration.staleness')}
                  </label>
                  <p className="text-xs text-text-muted mb-2">
                    {t('config.exploration.stalenessDesc')}
                  </p>
                  <div className="flex flex-col gap-1">
                    <input
                      id="bgExplorationStaleness"
                      type="number"
                      min={1}
                      step={1}
                      value={bgStalenessInput}
                      onChange={(e) => setBgStalenessInput(e.target.value)}
                      className="w-full max-w-[240px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                    {!stalenessValidation.valid && bgStalenessInput !== '' && (
                      <span className="text-xs text-warning">{stalenessValidation.error}</span>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="bgExplorationConcurrency"
                    className="block text-sm font-medium text-text mb-1"
                  >
                    {t('config.exploration.concurrency')}
                  </label>
                  <p className="text-xs text-text-muted mb-2">
                    {t('config.exploration.concurrencyDesc')}
                  </p>
                  <div className="flex flex-col gap-1">
                    <input
                      id="bgExplorationConcurrency"
                      type="number"
                      min={1}
                      max={16}
                      step={1}
                      value={bgConcurrencyInput}
                      onChange={(e) => setBgConcurrencyInput(e.target.value)}
                      className="w-full max-w-[200px] rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text font-mono placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    />
                    {!concurrencyValidation.valid && bgConcurrencyInput !== '' && (
                      <span className="text-xs text-warning">{concurrencyValidation.error}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Inline rate tunables — only rendered when background mode is off */}
            {!bgExploration.enabled && (
              <div className="flex flex-col gap-5">
                <div>
                  <label
                    htmlFor="performanceExplorationRate"
                    className="block text-sm font-medium text-text mb-1"
                  >
                    {t('config.exploration.performanceRate')}
                  </label>
                  <p className="text-xs text-text-muted mb-2">
                    {t('config.exploration.performanceRateDesc')}
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

                <div>
                  <label
                    htmlFor="latencyExplorationRate"
                    className="block text-sm font-medium text-text mb-1"
                  >
                    {t('config.exploration.latencyRate')}
                  </label>
                  <p className="text-xs text-text-muted mb-2">
                    {t('config.exploration.latencyRateDesc')}
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

                <div>
                  <label
                    htmlFor="e2ePerformanceExplorationRate"
                    className="block text-sm font-medium text-text mb-1"
                  >
                    {t('config.exploration.e2eRate')}
                  </label>
                  <p className="text-xs text-text-muted mb-2">
                    {t('config.exploration.e2eRateDesc')}
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
            )}
          </div>
        </Disclosure>

        <Card
          title={t('config.backup.title')}
          extra={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleFullBackupDownload}
                isLoading={isFullBackupLoading}
                leftIcon={<Archive size={14} />}
              >
                {t('config.backup.fullBackup')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackupDownload}
                isLoading={isBackupLoading}
                leftIcon={<HardDrive size={14} />}
              >
                {t('config.backup.configBackup')}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary mb-3">{t('config.backup.intro')}</p>

          <div className="p-3 bg-warning/10 border border-warning/30 rounded-md mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
              <div className="text-sm text-text-secondary">
                <p className="font-medium text-text">{t('config.backup.sensitiveTitle')}</p>
                <p className="mt-0.5 text-xs text-text-muted">{t('config.backup.sensitiveBody')}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <div className="flex-1">
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                {t('config.backup.configBackup')}
              </h4>
              <p className="text-xs text-text-muted mb-2">{t('config.backup.configBackupDesc')}</p>
            </div>
            <div className="flex-1">
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">
                {t('config.backup.fullBackup')}
              </h4>
              <p className="text-xs text-text-muted mb-2">{t('config.backup.fullBackupDesc')}</p>
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
              {t('config.backup.restoreFromFile')}
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
          title={t('config.cardLayout.title')}
          extra={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportLayout}
                leftIcon={<Download size={14} />}
              >
                {t('config.cardLayout.export')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleImportLayout}
                leftIcon={<Upload size={14} />}
              >
                {t('config.cardLayout.import')}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary mb-4">{t('config.cardLayout.intro')}</p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />

          <div>
            <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
              {t('config.cardLayout.currentOrder')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {cardLayout.length === 0 && (
                <p className="text-xs text-text-muted italic">
                  {t('config.cardLayout.defaultLayout')}
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
