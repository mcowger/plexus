import { EventEmitter } from 'node:events';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { logger } from '../utils/logger';

type HttpRequestLabels = 'method' | 'path' | 'status_code';
type HttpInFlightLabels = 'method' | 'path';
type TokenLabels = 'provider' | 'model' | 'type';
type CostLabels = 'provider' | 'model' | 'type';
type ProviderLabels = 'provider' | 'model';
type ErrorLabels = 'provider' | 'model' | 'error_type';

export interface MetricsConfig {
  enabled: boolean;
  collectSystemMetrics: boolean;
}

export class MetricsService extends EventEmitter {
  private readonly registry: Registry;
  private readonly config: MetricsConfig;

  private readonly httpRequestsTotal: Counter<HttpRequestLabels>;
  private readonly httpRequestDurationSeconds: Histogram<HttpRequestLabels>;
  private readonly httpRequestsInFlight: Gauge<HttpInFlightLabels>;
  private readonly tokensTotal: Counter<TokenLabels>;
  private readonly costTotal: Counter<CostLabels>;
  private readonly ttftSeconds: Histogram<ProviderLabels>;
  private readonly requestDurationSeconds: Histogram<ProviderLabels>;
  private readonly tokensPerSecond: Histogram<ProviderLabels>;
  private readonly errorsTotal: Counter<ErrorLabels>;
  private readonly providerHealth: Gauge<ProviderLabels>;

  constructor(config: MetricsConfig = { enabled: true, collectSystemMetrics: true }) {
    super();
    this.config = config;
    this.registry = new Registry();

    if (this.config.collectSystemMetrics) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.httpRequestsTotal = new Counter<HttpRequestLabels>({
      name: 'plexus_http_requests_total',
      help: 'Total HTTP requests received by Plexus',
      labelNames: ['method', 'path', 'status_code'],
      registers: [this.registry]
    });

    this.httpRequestDurationSeconds = new Histogram<HttpRequestLabels>({
      name: 'plexus_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'path', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry]
    });

    this.httpRequestsInFlight = new Gauge<HttpInFlightLabels>({
      name: 'plexus_http_requests_in_flight',
      help: 'Number of HTTP requests currently in flight',
      labelNames: ['method', 'path'],
      registers: [this.registry]
    });

    this.tokensTotal = new Counter<TokenLabels>({
      name: 'plexus_tokens_total',
      help: 'Total number of tokens processed',
      labelNames: ['provider', 'model', 'type'],
      registers: [this.registry]
    });

    this.costTotal = new Counter<CostLabels>({
      name: 'plexus_cost_total',
      help: 'Total USD cost processed by Plexus',
      labelNames: ['provider', 'model', 'type'],
      registers: [this.registry]
    });

    this.ttftSeconds = new Histogram<ProviderLabels>({
      name: 'plexus_ttft_seconds',
      help: 'Time to first token in seconds',
      labelNames: ['provider', 'model'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16],
      registers: [this.registry]
    });

    this.requestDurationSeconds = new Histogram<ProviderLabels>({
      name: 'plexus_request_duration_seconds',
      help: 'Inference request duration in seconds',
      labelNames: ['provider', 'model'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32],
      registers: [this.registry]
    });

    this.tokensPerSecond = new Histogram<ProviderLabels>({
      name: 'plexus_tokens_per_second',
      help: 'Observed tokens per second during inference',
      labelNames: ['provider', 'model'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry]
    });

    this.errorsTotal = new Counter<ErrorLabels>({
      name: 'plexus_errors_total',
      help: 'Total number of tracked errors',
      labelNames: ['provider', 'model', 'error_type'],
      registers: [this.registry]
    });

    this.providerHealth = new Gauge<ProviderLabels>({
      name: 'plexus_provider_health',
      help: 'Provider health status where 1 is healthy and 0 is unhealthy',
      labelNames: ['provider', 'model'],
      registers: [this.registry]
    });
  }

  startHttpRequest(method: string, path: string): void {
    if (!this.config.enabled) {
      return;
    }

    this.httpRequestsInFlight.inc({
      method: this.normalizeLabel(method),
      path: this.normalizePath(path)
    });
  }

  endHttpRequest(method: string, path: string, statusCode: string, durationMs: number): void {
    if (!this.config.enabled) {
      return;
    }

    const normalizedMethod = this.normalizeLabel(method);
    const normalizedPath = this.normalizePath(path);
    const normalizedStatusCode = this.normalizeLabel(statusCode);
    const durationSeconds = this.msToSeconds(durationMs);

    this.httpRequestsInFlight.dec({ method: normalizedMethod, path: normalizedPath });
    this.httpRequestsTotal.inc({
      method: normalizedMethod,
      path: normalizedPath,
      status_code: normalizedStatusCode
    });
    this.httpRequestDurationSeconds.observe(
      {
        method: normalizedMethod,
        path: normalizedPath,
        status_code: normalizedStatusCode
      },
      durationSeconds
    );
  }

  trackTokens(provider: string, model: string, type: 'input' | 'output' | 'cached' | 'reasoning', count: number): void {
    if (!this.config.enabled || !Number.isFinite(count) || count <= 0) {
      return;
    }

    this.tokensTotal.inc(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model),
        type
      },
      count
    );
  }

  trackCost(provider: string, model: string, type: 'input' | 'output' | 'cached' | 'total', amountUsd: number): void {
    if (!this.config.enabled || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return;
    }

    this.costTotal.inc(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model),
        type
      },
      amountUsd
    );
  }

  trackTtft(provider: string, model: string, ttftMs: number): void {
    if (!this.config.enabled || !Number.isFinite(ttftMs) || ttftMs < 0) {
      return;
    }

    this.ttftSeconds.observe(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model)
      },
      this.msToSeconds(ttftMs)
    );
  }

  trackRequestDuration(provider: string, model: string, durationMs: number): void {
    if (!this.config.enabled || !Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }

    this.requestDurationSeconds.observe(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model)
      },
      this.msToSeconds(durationMs)
    );
  }

  trackTokensPerSecond(provider: string, model: string, value: number): void {
    if (!this.config.enabled || !Number.isFinite(value) || value < 0) {
      return;
    }

    this.tokensPerSecond.observe(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model)
      },
      value
    );
  }

  trackError(provider: string, model: string, errorType: string): void {
    if (!this.config.enabled) {
      return;
    }

    this.errorsTotal.inc({
      provider: this.normalizeLabel(provider),
      model: this.normalizeLabel(model),
      error_type: this.normalizeLabel(errorType)
    });
  }

  setProviderHealth(provider: string, model: string, healthy: boolean): void {
    if (!this.config.enabled) {
      return;
    }

    this.providerHealth.set(
      {
        provider: this.normalizeLabel(provider),
        model: this.normalizeLabel(model)
      },
      healthy ? 1 : 0
    );
  }

  async collectMetrics(): Promise<string> {
    if (!this.config.enabled) {
      return '';
    }

    try {
      return await this.registry.metrics();
    } catch (error) {
      logger.error('Failed to collect Prometheus metrics', error);
      return '';
    }
  }

  getMetricsContentType(): string {
    return this.registry.contentType;
  }

  private normalizeLabel(value: string | null | undefined): string {
    if (!value) {
      return 'unknown';
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : 'unknown';
  }

  private normalizePath(path: string): string {
    const normalized = this.normalizeLabel(path);
    const queryIndex = normalized.indexOf('?');
    if (queryIndex >= 0) {
      return normalized.slice(0, queryIndex);
    }
    return normalized;
  }

  private msToSeconds(valueMs: number): number {
    return Math.max(valueMs, 0) / 1000;
  }
}
