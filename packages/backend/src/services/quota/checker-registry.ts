import { z } from 'zod';
import type { Meter, MeterStatus, Utilization, MeterKind } from '../../types/meter';
import { getCurrentDialect, getDatabase, getSchema } from '../../db/client';
import { eq } from 'drizzle-orm';
import {
  buildCustomCheckerHeaders,
  createCustomCheckerFetch,
  runCustomChecker,
} from './custom-checker-runtime';

// ── Context passed to each checker's check() method ─────────────────────────

export interface MeterContext {
  checkerId: string;
  provider: string;
  options: Record<string, unknown>;
  getOption<T>(key: string, defaultValue: T): T;
  requireOption<T>(key: string): T;
  requestHeaders(): Record<string, string>;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  balance(params: BalanceParams): Meter;
  allowance(params: AllowanceParams): Meter;
}

export interface BalanceParams {
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

export interface AllowanceParams {
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
  displayName: string;
  optionsSchema: TOptions;
  check(ctx: MeterContext): Promise<Meter[]>;
}

// ── In-process registry ───────────────────────────────────────────────────────

const REGISTRY = new Map<string, CheckerDefinition>();
const CUSTOM_CHECKER_TYPES = new Set<string>();

export function registerCheckerDefinition(
  def: CheckerDefinition,
  source: 'builtin' | 'custom'
): CheckerDefinition {
  if (REGISTRY.has(def.type)) {
    throw new Error(`Quota checker type '${def.type}' is already registered`);
  }
  REGISTRY.set(def.type, def);
  if (source === 'custom') CUSTOM_CHECKER_TYPES.add(def.type);
  return def;
}

export function defineChecker<TOptions extends z.ZodTypeAny>(
  def: CheckerDefinition<TOptions>
): CheckerDefinition<TOptions> {
  registerCheckerDefinition(def as unknown as CheckerDefinition, 'builtin');
  return def;
}

export function getCheckerTypes(): string[] {
  return Array.from(REGISTRY.keys());
}

export function getCheckerDefinitions(): CheckerDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getCheckerDefinition(type: string): CheckerDefinition | undefined {
  return REGISTRY.get(type);
}

export function isCheckerRegistered(type: string): boolean {
  return REGISTRY.has(type);
}

export function validateCheckerOptions(type: string, options: Record<string, unknown>) {
  const definition = getCheckerDefinition(type);
  if (!definition) {
    return {
      success: false as const,
      error: new z.ZodError([
        {
          code: 'custom',
          path: ['type'],
          message: `Unknown quota checker type '${type}'`,
        },
      ]),
    };
  }
  return definition.optionsSchema.safeParse(options);
}

export function isCustomCheckerRegistered(type: string): boolean {
  return CUSTOM_CHECKER_TYPES.has(type);
}

function removeCustomCheckerDefinitions(): void {
  for (const type of CUSTOM_CHECKER_TYPES) REGISTRY.delete(type);
  CUSTOM_CHECKER_TYPES.clear();
}

export async function loadCustomCheckers(): Promise<void> {
  removeCustomCheckerDefinitions();

  const schema = getSchema();
  const rows = await getDatabase()
    .select()
    .from(schema.customCheckers)
    .where(eq(schema.customCheckers.enabled, getCurrentDialect() === 'sqlite' ? 1 : true));

  for (const row of rows) {
    const type = row.id.trim();
    if (!type || REGISTRY.has(type)) {
      throw new Error(`Custom quota checker type '${row.id}' collides with a registered checker`);
    }

    registerCheckerDefinition(
      {
        type,
        displayName: row.displayName,
        optionsSchema: z.record(z.string(), z.any()),
        check: (ctx) => runCustomChecker(row.code, ctx),
      },
      'custom'
    );
  }
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

/**
 * A balance meter is exhausted when the remaining balance is at or below
 * zero. Non-finite values (NaN/Infinity) are also treated as exhausted so
 * callers gating on exhausted balances get a single consistent signal.
 */
function isBalanceExhausted(remaining: number | undefined): boolean {
  if (remaining === undefined) return false;
  if (!Number.isFinite(remaining)) return true;
  return remaining <= 0;
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

    requestHeaders(): Record<string, string> {
      return buildCustomCheckerHeaders(options);
    },

    fetch: createCustomCheckerFetch(options),

    balance(params: BalanceParams): Meter {
      const hasLimitAndUsed = params.limit !== undefined && params.used !== undefined;
      const utilization: Utilization = hasLimitAndUsed
        ? deriveUtilization(params.used, params.limit, params.remaining)
        : isBalanceExhausted(params.remaining)
          ? 100
          : 'not_applicable';

      const status = isBalanceExhausted(params.remaining) ? 'exhausted' : deriveStatus(utilization);

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
//
// TODO: when Bun ships import.meta.glob (PR #21459), replace the explicit
// imports below with:
//   const mods = import.meta.glob('./checkers/*-checker.ts', { eager: true });

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
  await import('./checkers/routing-run-checker');
  await import('./checkers/ollama-checker');
  await import('./checkers/neuralwatt-checker');
  await import('./checkers/zenmux-checker');
  await import('./checkers/devpass-checker');
  await import('./checkers/wafer-checker');
  await import('./checkers/opencode-go-checker');
  await import('./checkers/crof-checker');
  await import('./checkers/exedev-checker');
  await import('./checkers/hyper-checker');
  await import('./checkers/deepseek-checker');
  await import('./checkers/sakana-checker');
  await import('./checkers/cline-checker');
  await loadCustomCheckers();
}
