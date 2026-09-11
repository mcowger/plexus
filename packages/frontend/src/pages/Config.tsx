import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../lib/api';
import type {
  CompactionSettings as CompactionConfig,
  McpOAuthSettings as McpOAuthConfig,
} from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import type { CardLayout } from '../types/card';
import { DEFAULT_CARD_ORDER, LAYOUT_STORAGE_KEY } from '../types/card';
import { DisplayPreferencesCard } from '../components/config/DisplayPreferencesCard';
import { FailoverSettings } from '../components/config/FailoverSettings';
import { TraceCaptureSettings } from '../components/config/TraceCaptureSettings';
import { CooldownSettings } from '../components/config/CooldownSettings';
import { TimeoutSettings } from '../components/config/TimeoutSettings';
import { StallDetectionSettings } from '../components/config/StallDetectionSettings';
import { CompactionSettings } from '../components/config/CompactionSettings';
import { McpOAuthSettings } from '../components/config/McpOAuthSettings';
import { ExplorationSettings } from '../components/config/ExplorationSettings';
import { NetworkSettings } from '../components/config/NetworkSettings';
import { ModelMetadataCard } from '../components/config/ModelMetadataCard';
import { BackupRestoreCard } from '../components/config/BackupRestoreCard';
import { CardLayoutCard } from '../components/config/CardLayoutCard';
import { ConfigurationSnapshot } from '../components/config/ConfigurationSnapshot';
import {
  DEFAULT_BACKGROUND_EXPLORATION,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_COOLDOWN_POLICY,
  DEFAULT_EXPLORATION_RATES,
  DEFAULT_FAILOVER_POLICY,
  DEFAULT_MCP_OAUTH_CONFIG,
  DEFAULT_STALL_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
} from '../components/config/types';
import type {
  BackgroundExplorationConfig,
  CooldownPolicy,
  ExplorationRates,
  FailoverPolicy,
  StallConfig,
  TimeoutConfig,
} from '../components/config/types';

export const Config = () => {
  const toast = useToast();
  const [config, setConfig] = useState('');
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isBackupLoading, setIsBackupLoading] = useState(false);
  const [isFullBackupLoading, setIsFullBackupLoading] = useState(false);
  const [isRestoreLoading, setIsRestoreLoading] = useState(false);
  const [isResetLogsLoading, setIsResetLogsLoading] = useState(false);
  const [isMetadataRefreshLoading, setIsMetadataRefreshLoading] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Failover settings state
  const [failoverPolicy, setFailoverPolicy] = useState<FailoverPolicy>(DEFAULT_FAILOVER_POLICY);
  const [failoverLoaded, setFailoverLoaded] = useState(false);
  const [failoverSaving, setFailoverSaving] = useState(false);
  const [statusCodesText, setStatusCodesText] = useState('');
  const [errorsText, setErrorsText] = useState('');

  // Capture-trace-on-error toggle (persisted admin setting)
  const [captureTraceOnError, setCaptureTraceOnError] = useState(false);
  const [captureTraceLoaded, setCaptureTraceLoaded] = useState(false);
  const [captureTraceSaving, setCaptureTraceSaving] = useState(false);

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

  // Context Compaction settings state
  const [compactionConfig, setCompactionConfig] =
    useState<CompactionConfig>(DEFAULT_COMPACTION_CONFIG);
  const [compactionLoaded, setCompactionLoaded] = useState(false);
  const [compactionSaving, setCompactionSaving] = useState(false);

  // MCP OAuth settings state
  const [mcpOAuthConfig, setMcpOAuthConfig] = useState<McpOAuthConfig>(DEFAULT_MCP_OAUTH_CONFIG);
  const [mcpOAuthLoaded, setMcpOAuthLoaded] = useState(false);
  const [mcpOAuthSaving, setMcpOAuthSaving] = useState(false);
  const [mcpOAuthIssuerInput, setMcpOAuthIssuerInput] = useState('');

  const validateIssuerInput = (raw: string): { valid: boolean; error?: string } => {
    const trimmed = raw.trim();
    if (!trimmed) return { valid: true };
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { valid: false, error: 'Must use http:// or https://' };
      }
      return { valid: true };
    } catch {
      return { valid: false, error: 'Enter a well-formed URL' };
    }
  };

  const issuerValidation = validateIssuerInput(mcpOAuthIssuerInput);

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

  const initialValidation = validateCooldownInput(cooldownInitialInput);
  const maxValidation = validateCooldownInput(cooldownMaxInput);

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

  const loadCaptureTraceOnError = useCallback(async () => {
    try {
      const { enabled } = await api.getCaptureTraceOnError();
      setCaptureTraceOnError(enabled);
      setCaptureTraceLoaded(true);
    } catch (e) {
      console.error('Failed to load capture-trace-on-error setting:', e);
      toast.error('Failed to load trace capture settings');
    }
  }, [toast]);

  const handleToggleCaptureTraceOnError = async (checked: boolean) => {
    const previous = captureTraceOnError;
    setCaptureTraceOnError(checked);
    setCaptureTraceSaving(true);
    try {
      const { enabled } = await api.setCaptureTraceOnError(checked);
      setCaptureTraceOnError(enabled);
      toast.success(`Capture trace on error ${enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      setCaptureTraceOnError(previous);
      toast.error((e as Error).message, 'Failed to update trace capture settings');
    } finally {
      setCaptureTraceSaving(false);
    }
  };

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

  const loadCompactionConfig = useCallback(async () => {
    try {
      const cfg = await api.getCompactionConfig();
      // Merge over defaults so the UI state always has a complete shape
      // (e.g. strategy defined) even when the backend returns {}.
      setCompactionConfig({ ...DEFAULT_COMPACTION_CONFIG, ...cfg });
      setCompactionLoaded(true);
    } catch (e) {
      console.error('Failed to load compaction config:', e);
      toast.error('Failed to load compaction settings');
    }
  }, [toast]);

  const loadMcpOAuthConfig = useCallback(async () => {
    try {
      const settings = await api.getSystemSettings();
      const raw = settings.mcpOAuth as Partial<McpOAuthConfig> | undefined;
      const cfg: McpOAuthConfig = {
        enabled: raw?.enabled === true,
        provider: raw?.provider === 'plexus-idp' ? raw.provider : 'plexus-idp',
        ...(typeof raw?.issuer === 'string' && raw.issuer.trim()
          ? { issuer: raw.issuer.trim() }
          : {}),
      };
      setMcpOAuthConfig(cfg);
      setMcpOAuthIssuerInput(cfg.issuer ?? '');
      setMcpOAuthLoaded(true);
    } catch (e) {
      console.error('Failed to load MCP OAuth settings:', e);
      toast.error('Failed to load MCP OAuth settings');
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

  const handleSaveCompaction = async () => {
    setCompactionSaving(true);
    try {
      const updated = await api.patchCompactionConfig(compactionConfig);
      setCompactionConfig(updated);
      toast.success('Compaction settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save compaction settings');
    } finally {
      setCompactionSaving(false);
    }
  };

  const handleSaveMcpOAuth = async () => {
    if (!issuerValidation.valid) return;
    setMcpOAuthSaving(true);
    try {
      const issuer = mcpOAuthIssuerInput.trim();
      const next: McpOAuthConfig = {
        enabled: mcpOAuthConfig.enabled,
        provider: 'plexus-idp',
        ...(issuer ? { issuer } : {}),
      };
      await api.patchSystemSettings({ mcpOAuth: next });
      setMcpOAuthConfig(next);
      setMcpOAuthIssuerInput(next.issuer ?? '');
      toast.success('MCP OAuth settings saved');
    } catch (e) {
      toast.error((e as Error).message, 'Failed to save MCP OAuth settings');
    } finally {
      setMcpOAuthSaving(false);
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
    loadCaptureTraceOnError();
    loadCooldownPolicy();
    loadTrustedProxies();
    loadTimeoutConfig();
    loadStallConfig();
    loadCompactionConfig();
    loadMcpOAuthConfig();
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

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
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

  const handleRestoreFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
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

  const handleRefreshMetadata = async () => {
    setIsMetadataRefreshLoading(true);
    try {
      const result = await api.refreshModelMetadata();
      if (result.hadErrors) {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } catch (e) {
      toast.error((e as Error).message, 'Failed to refresh model metadata');
    } finally {
      setIsMetadataRefreshLoading(false);
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
          <DisplayPreferencesCard />

          <FailoverSettings
            policy={failoverPolicy}
            loaded={failoverLoaded}
            saving={failoverSaving}
            statusCodesText={statusCodesText}
            errorsText={errorsText}
            onEnabledChange={(enabled) =>
              setFailoverPolicy((previous) => ({ ...previous, enabled }))
            }
            onStatusCodesChange={setStatusCodesText}
            onErrorsChange={setErrorsText}
            onSave={handleSaveFailover}
          />

          <TraceCaptureSettings
            enabled={captureTraceOnError}
            loaded={captureTraceLoaded}
            saving={captureTraceSaving}
            onChange={handleToggleCaptureTraceOnError}
          />

          <CooldownSettings
            policy={cooldownPolicy}
            loaded={cooldownLoaded}
            saving={cooldownSaving}
            initialInput={cooldownInitialInput}
            maxInput={cooldownMaxInput}
            initialValidation={initialValidation}
            maxValidation={maxValidation}
            onInitialChange={setCooldownInitialInput}
            onMaxChange={setCooldownMaxInput}
            onSave={handleSaveCooldown}
          />

          <TimeoutSettings
            config={timeoutConfig}
            loaded={timeoutLoaded}
            saving={timeoutSaving}
            defaultInput={timeoutDefaultInput}
            validation={timeoutDefaultValidation}
            onDefaultChange={setTimeoutDefaultInput}
            onSave={handleSaveTimeout}
          />

          <StallDetectionSettings
            loaded={stallLoaded}
            saving={stallSaving}
            ttfbInput={stallTtfbInput}
            ttfbBytesInput={stallTtfbBytesInput}
            minBpsInput={stallMinBpsInput}
            windowInput={stallWindowInput}
            graceInput={stallGraceInput}
            ttfbValidation={stallTtfbValidation}
            ttfbBytesValidation={stallTtfbBytesValidation}
            minBpsValidation={stallMinBpsValidation}
            windowValidation={stallWindowValidation}
            graceValidation={stallGraceValidation}
            onTtfbChange={setStallTtfbInput}
            onTtfbBytesChange={setStallTtfbBytesInput}
            onMinBpsChange={setStallMinBpsInput}
            onWindowChange={setStallWindowInput}
            onGraceChange={setStallGraceInput}
            onSave={handleSaveStall}
          />

          <CompactionSettings
            config={compactionConfig}
            loaded={compactionLoaded}
            saving={compactionSaving}
            onChange={setCompactionConfig}
            onSave={handleSaveCompaction}
          />

          <McpOAuthSettings
            config={mcpOAuthConfig}
            loaded={mcpOAuthLoaded}
            saving={mcpOAuthSaving}
            issuerInput={mcpOAuthIssuerInput}
            issuerValidation={issuerValidation}
            onEnabledChange={(enabled) => setMcpOAuthConfig({ ...mcpOAuthConfig, enabled })}
            onIssuerChange={setMcpOAuthIssuerInput}
            onSave={handleSaveMcpOAuth}
          />

          <ExplorationSettings
            background={bgExploration}
            saving={explorationSaving}
            backgroundSaving={bgExplorationSaving}
            stalenessInput={bgStalenessInput}
            concurrencyInput={bgConcurrencyInput}
            performanceInput={explorationPerformanceInput}
            latencyInput={explorationLatencyInput}
            e2eInput={explorationE2EInput}
            stalenessValidation={stalenessValidation}
            concurrencyValidation={concurrencyValidation}
            performanceValidation={perfValidation}
            latencyValidation={latValidation}
            e2eValidation={e2eValidation}
            valid={isExplorationValid}
            onBackgroundEnabledChange={(enabled) =>
              setBgExploration((previous) => ({ ...previous, enabled }))
            }
            onStalenessChange={setBgStalenessInput}
            onConcurrencyChange={setBgConcurrencyInput}
            onPerformanceChange={setExplorationPerformanceInput}
            onLatencyChange={setExplorationLatencyInput}
            onE2EChange={setExplorationE2EInput}
            onSave={handleSaveExploration}
          />

          <NetworkSettings
            trustedProxies={trustedProxies}
            loaded={trustedProxiesLoaded}
            saving={trustedProxiesSaving}
            onChange={setTrustedProxies}
            onSave={handleSaveTrustedProxies}
          />

          <ModelMetadataCard loading={isMetadataRefreshLoading} onRefresh={handleRefreshMetadata} />

          <BackupRestoreCard
            restoreInputRef={restoreInputRef}
            restoreLoading={isRestoreLoading}
            fullBackupLoading={isFullBackupLoading}
            backupLoading={isBackupLoading}
            resetLogsLoading={isResetLogsLoading}
            onRestoreClick={handleRestoreClick}
            onRestoreFileSelect={handleRestoreFileSelect}
            onFullBackupDownload={handleFullBackupDownload}
            onBackupDownload={handleBackupDownload}
            onResetLogs={handleResetLogs}
          />

          <CardLayoutCard
            cardLayout={cardLayout}
            fileInputRef={fileInputRef}
            onExport={handleExportLayout}
            onImport={handleImportLayout}
            onFileSelect={handleFileSelect}
          />

          <ConfigurationSnapshot
            config={config}
            loaded={isConfigLoaded}
            restarting={isRestarting}
            onRefresh={loadConfig}
            onRestart={handleRestart}
            onExport={handleExportConfig}
          />
        </div>
      </PageContainer>
    </div>
  );
};
