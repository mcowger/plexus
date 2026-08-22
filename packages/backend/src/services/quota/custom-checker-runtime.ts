import type { Meter } from '../../types/meter';
import type { AllowanceParams, BalanceParams, MeterContext } from './checker-registry';

const DEFAULT_TIMEOUT_MS = 10_000;
const METER_MARKER = '__plexus_quota_meter__';

function getOptionString(options: Record<string, unknown>, key: string, fallback: string): string {
  const value = options[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function buildCustomCheckerHeaders(
  options: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }
  }

  if (
    options.useApiKey !== false &&
    typeof options.apiKey === 'string' &&
    options.apiKey.length > 0
  ) {
    const header = getOptionString(options, 'authHeader', 'Authorization');
    const prefix = getOptionString(options, 'authPrefix', 'Bearer').trim();
    headers[header] = prefix ? `${prefix} ${options.apiKey}` : options.apiKey;
  }

  return headers;
}

export function createCustomCheckerFetch(options: Record<string, unknown>) {
  return (input: string | URL, init: RequestInit = {}) => {
    const headers = new Headers(buildCustomCheckerHeaders(options));
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return globalThis.fetch(input, { ...init, headers });
  };
}

type MeterMarker =
  | { [METER_MARKER]: 'balance'; params: BalanceParams }
  | { [METER_MARKER]: 'allowance'; params: AllowanceParams };

type WorkerRequest = {
  code: string;
  checkerId: string;
  provider: string;
  options: Record<string, unknown>;
};

type WorkerResponse =
  | { ok: true; meters: unknown }
  | { ok: false; error: string; errorType: 'syntax' | 'runtime' };

export class CustomCheckerError extends Error {
  constructor(
    message: string,
    readonly errorType: 'syntax' | 'runtime' | 'timeout'
  ) {
    super(message);
    this.name = 'CustomCheckerError';
  }
}

export function validateCustomCheckerCode(code: string): void {
  try {
    new Function('ctx', `"use strict"; return (async () => {\n${code}\n})();`);
  } catch (error) {
    throw new CustomCheckerError(error instanceof Error ? error.message : String(error), 'syntax');
  }
}

function isMeterMarker(value: unknown): value is MeterMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Record<string, unknown>;
  return marker[METER_MARKER] === 'balance' || marker[METER_MARKER] === 'allowance';
}

function normalizeMeters(value: unknown): MeterMarker[] {
  if (!Array.isArray(value)) {
    throw new CustomCheckerError('Custom checker must return an array of meters', 'runtime');
  }
  if (!value.every(isMeterMarker)) {
    throw new CustomCheckerError(
      'Custom checker returned an invalid meter. Return values from ctx.balance() or ctx.allowance().',
      'runtime'
    );
  }
  return value;
}

function materializeMeters(ctx: MeterContext, markers: MeterMarker[]): Meter[] {
  return markers.map((marker) =>
    marker[METER_MARKER] === 'balance' ? ctx.balance(marker.params) : ctx.allowance(marker.params)
  );
}

export async function runCustomChecker(
  code: string,
  ctx: MeterContext,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Meter[]> {
  validateCustomCheckerCode(code);

  const worker = new Worker(new URL('./custom-checker-worker.ts', import.meta.url), {
    type: 'module',
  });

  const request: WorkerRequest = {
    code,
    checkerId: ctx.checkerId,
    provider: ctx.provider,
    options: ctx.options,
  };

  try {
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new CustomCheckerError(`Custom checker timed out after ${timeoutMs}ms`, 'timeout'));
      }, timeoutMs);

      worker.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data as WorkerResponse);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new CustomCheckerError(event.message || 'Custom checker worker failed', 'runtime'));
      };
      worker.postMessage(request);
    });

    if (!response.ok) {
      throw new CustomCheckerError(response.error, response.errorType);
    }
    return materializeMeters(ctx, normalizeMeters(response.meters));
  } finally {
    worker.terminate();
  }
}
