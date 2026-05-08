import { z } from 'zod';
import type { Meter, MeterStatus, Utilization, MeterKind } from '../../types/meter';

// ── Context passed to each checker's check() method ─────────────────────────

export interface MeterContext {
  checkerId: string;
  provider: string;
  options: Record<string, unknown>;
  getOption<T>(key: string, defaultValue: T): T;
  requireOption<T>(key: string): T;
  balance(params: BalanceParams): Meter;
  allowance(params: AllowanceParams): Meter;
}

interface BalanceParams {
  key: string;
  label: string;
  unit: string;
  remaining?: number;
  limit?: number;
  used?: number;
  group?: string;
  scope?: string;
  exhaustionThreshold?: number;
}

interface AllowanceParams {
  key: string;
  label: string;
  unit: string;
  periodValue: number;
  periodUnit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  periodCycle: 'fixed' | 'rolling';
  used?: number;
  limit?: number;
  remaining?: number;
  resetsAt?: string;
  group?: string;
  scope?: string;
  exhaustionThreshold?: number;
}

// ── Registry entry ────────────────────────────────────────────────────────────

export interface CheckerDefinition<TOptions extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  optionsSchema: TOptions;
  check(ctx: MeterContext): Promise<Meter[]>;
}

// ── In-process registry ───────────────────────────────────────────────────────

const REGISTRY = new Map<string, CheckerDefinition>();

export function defineChecker<TOptions extends z.ZodTypeAny>(
  def: CheckerDefinition<TOptions>
): CheckerDefinition<TOptions> {
  REGISTRY.set(def.type, def as unknown as CheckerDefinition);
  return def;
}

export function getCheckerTypes(): string[] {
  return Array.from(REGISTRY.keys());
}

export function getCheckerDefinition(type: string): CheckerDefinition | undefined {
  return REGISTRY.get(type);
}

export function isCheckerRegistered(type: string): boolean {
  return REGISTRY.has(type);
}

// ── Context factory ───────────────────────────────────────────────────────────

function deriveUtilization(
  used: number | undefined,
  limit: number | undefined,
  remaining: number | undefined
): Utilization {
  if (limit !== undefined && limit > 0 && used !== undefined) {
    return Math.min(100, (used / limit) * 100);
  }
  if (used !== undefined && remaining !== undefined) {
    const total = used + remaining;
    if (total > 0) return Math.min(100, (used / total) * 100);
  }
  return 'unknown';
}

function deriveStatus(utilization: Utilization): MeterStatus {
  if (utilization === 'unknown' || utilization === 'not_applicable') return 'ok';
  if (utilization >= 100) return 'exhausted';
  if (utilization >= 90) return 'critical';
  if (utilization >= 75) return 'warning';
  return 'ok';
}

export function createMeterContext(
  checkerId: string,
  provider: string,
  options: Record<string, unknown>
): MeterContext {
  return {
    checkerId,
    provider,
    options,

    getOption<T>(key: string, defaultValue: T): T {
      return (options[key] as T) ?? defaultValue;
    },

    requireOption<T>(key: string): T {
      const value = options[key] as T | undefined;
      if (value === undefined) {
        throw new Error(`Required option '${key}' not provided for quota checker '${checkerId}'`);
      }
      return value;
    },

    balance(params: BalanceParams): Meter {
      const utilization: Utilization =
        params.limit !== undefined && params.used !== undefined
          ? deriveUtilization(params.used, params.limit, params.remaining)
          : 'not_applicable';

      const status = deriveStatus(utilization);

      return {
        key: params.key,
        label: params.label,
        kind: 'balance' as MeterKind,
        unit: params.unit,
        limit: params.limit,
        used: params.used,
        remaining: params.remaining,
        utilizationPercent: utilization,
        status,
        group: params.group,
        scope: params.scope,
        exhaustionThreshold: params.exhaustionThreshold,
      };
    },

    allowance(params: AllowanceParams): Meter {
      const utilization = deriveUtilization(params.used, params.limit, params.remaining);
      const status = deriveStatus(utilization);

      return {
        key: params.key,
        label: params.label,
        kind: 'allowance' as MeterKind,
        unit: params.unit,
        limit: params.limit,
        used: params.used,
        remaining: params.remaining,
        utilizationPercent: utilization,
        periodValue: params.periodValue,
        periodUnit: params.periodUnit,
        periodCycle: params.periodCycle,
        resetsAt: params.resetsAt,
        status,
        group: params.group,
        scope: params.scope,
        exhaustionThreshold: params.exhaustionThreshold,
      };
    },
  };
}

// ── Import all checkers to trigger self-registration ─────────────────────────
// This file must be imported once at startup. Each checker file calls
// defineChecker() at module load time, which populates REGISTRY.

export async function loadAllCheckers(): Promise<void> {
  await import('./checkers/naga-checker');
  await import('./checkers/synthetic-checker');
  await import('./checkers/nanogpt-checker');
  await import('./checkers/zai-checker');
  await import('./checkers/moonshot-checker');
  await import('./checkers/novita-checker');
  await import('./checkers/minimax-checker');
  await import('./checkers/minimax-coding-checker');
  await import('./checkers/openrouter-checker');
  await import('./checkers/kilo-checker');
  await import('./checkers/openai-codex-checker');
  await import('./checkers/kimi-code-checker');
  await import('./checkers/claude-code-checker');
  await import('./checkers/copilot-checker');
  await import('./checkers/wisdomgate-checker');
  await import('./checkers/apertis-checker');
  await import('./checkers/poe-checker');
  await import('./checkers/gemini-cli-checker');
  await import('./checkers/antigravity-checker');
  await import('./checkers/ollama-checker');
  await import('./checkers/neuralwatt-checker');
  await import('./checkers/zenmux-checker');
  await import('./checkers/devpass-checker');
}
