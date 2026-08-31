import { logger } from '../utils/logger';

const SQLITE_SLOW_QUERY_ENV = 'PLEXUS_SQLITE_SLOW_QUERY_MS';
const MAX_LOGGED_SQL_LENGTH = 1000;
const SQLITE_CONTENTION_PATTERN = /SQLITE_(?:BUSY|LOCKED)|database\s+(?:is\s+)?(?:busy|locked)/i;
const STATEMENT_EXECUTION_METHODS = new Set(['all', 'get', 'raw', 'run', 'values']);
const TRANSACTION_MODES = new Set(['deferred', 'immediate', 'exclusive']);

type SqliteDatabase = {
  prepare: (...args: any[]) => any;
  query: (...args: any[]) => any;
  run: (...args: any[]) => any;
  exec: (...args: any[]) => any;
  transaction: (...args: any[]) => any;
};

type SqliteDiagnosticsConfig = {
  slowQueryMs: number;
};

export function getSqliteSlowQueryThresholdMs(
  value: string | undefined = process.env[SQLITE_SLOW_QUERY_ENV]
): number | null {
  if (!value?.trim()) return null;

  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : null;
}

export function isSQLiteContentionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  const text = [candidate.code, candidate.message, candidate.name]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join(' ');

  return SQLITE_CONTENTION_PATTERN.test(text);
}

function sanitizeSql(sql: string): string {
  const normalized = sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/'(?:''|[^'])*'/g, "'?' ")
    .trim();

  if (normalized.length <= MAX_LOGGED_SQL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_LOGGED_SQL_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ');
  return String(error).replace(/\s+/g, ' ');
}

function logSlowQuery(
  sql: string,
  operation: string,
  durationMs: number,
  thresholdMs: number
): void {
  logger.warn(
    `SQLite slow query (${durationMs.toFixed(1)}ms >= ${thresholdMs}ms) [${operation}]: ${sanitizeSql(sql)}`
  );
}

function logContention(sql: string, operation: string, durationMs: number, error: unknown): void {
  logger.warn(
    `SQLite contention during ${operation} (${durationMs.toFixed(1)}ms): ${sanitizeSql(sql)}; ${errorMessage(error)}`
  );
}

function measureSqliteOperation<T>(
  sql: string,
  operation: string,
  config: SqliteDiagnosticsConfig,
  operationFn: () => T
): T {
  const startedAt = performance.now();

  try {
    const result = operationFn();
    const durationMs = performance.now() - startedAt;
    if (durationMs >= config.slowQueryMs) {
      logSlowQuery(sql, operation, durationMs, config.slowQueryMs);
    }
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    if (isSQLiteContentionError(error)) {
      logContention(sql, operation, durationMs, error);
    } else if (durationMs >= config.slowQueryMs) {
      logSlowQuery(sql, operation, durationMs, config.slowQueryMs);
    }
    throw error;
  }
}

function instrumentStatement(
  statement: object,
  sql: string,
  config: SqliteDiagnosticsConfig
): object {
  return new Proxy(statement, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (
        typeof property === 'string' &&
        STATEMENT_EXECUTION_METHODS.has(property) &&
        typeof method === 'function'
      ) {
        return (...args: unknown[]) =>
          measureSqliteOperation(sql, property, config, () => Reflect.apply(method, target, args));
      }

      return typeof method === 'function' ? method.bind(target) : method;
    },
  });
}

function instrumentTransaction(
  transaction: (...args: any[]) => any,
  config: SqliteDiagnosticsConfig
): (...args: any[]) => any {
  return new Proxy(transaction, {
    apply(target, thisArg, args) {
      return measureSqliteOperation('transaction', 'transaction', config, () =>
        Reflect.apply(target, thisArg, args)
      );
    },
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (
        typeof property === 'string' &&
        TRANSACTION_MODES.has(property) &&
        typeof method === 'function'
      ) {
        return (...args: unknown[]) =>
          measureSqliteOperation('transaction', property, config, () =>
            Reflect.apply(method, target, args)
          );
      }

      return typeof method === 'function' ? method.bind(target) : method;
    },
  });
}

export function instrumentSqliteDatabase<T extends SqliteDatabase>(database: T): T {
  const slowQueryMs = getSqliteSlowQueryThresholdMs();
  if (slowQueryMs === null) return database;

  const config = { slowQueryMs };
  logger.info(`SQLite slow-query diagnostics enabled (threshold: ${slowQueryMs}ms)`);

  return new Proxy(database, {
    get(target, property) {
      const method = Reflect.get(target, property, target);

      if (property === 'prepare' || property === 'query') {
        if (typeof method !== 'function') return method;
        return (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
          const statement = measureSqliteOperation(sql, String(property), config, () =>
            Reflect.apply(method, target, args)
          );
          return instrumentStatement(statement, sql, config);
        };
      }

      if (property === 'run' || property === 'exec') {
        if (typeof method !== 'function') return method;
        return (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
          return measureSqliteOperation(sql, String(property), config, () =>
            Reflect.apply(method, target, args)
          );
        };
      }

      if (property === 'transaction' && typeof method === 'function') {
        return (...args: unknown[]) => {
          const transaction = Reflect.apply(method, target, args);
          return typeof transaction === 'function'
            ? instrumentTransaction(transaction, config)
            : transaction;
        };
      }

      return typeof method === 'function' ? method.bind(target) : method;
    },
  }) as T;
}
