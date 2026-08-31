import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { logger } from '../../utils/logger';
import {
  getSqliteSlowQueryThresholdMs,
  instrumentSqliteDatabase,
  isSQLiteContentionError,
} from '../sqlite-diagnostics';

describe('SQLite diagnostics', () => {
  let originalThreshold: string | undefined;

  beforeEach(() => {
    originalThreshold = process.env.PLEXUS_SQLITE_SLOW_QUERY_MS;
  });

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.PLEXUS_SQLITE_SLOW_QUERY_MS;
    } else {
      process.env.PLEXUS_SQLITE_SLOW_QUERY_MS = originalThreshold;
    }
  });

  test('only enables a positive threshold', () => {
    expect(getSqliteSlowQueryThresholdMs()).toBeNull();
    expect(getSqliteSlowQueryThresholdMs('0')).toBeNull();
    expect(getSqliteSlowQueryThresholdMs('-1')).toBeNull();
    expect(getSqliteSlowQueryThresholdMs('250')).toBe(250);
  });

  test('recognizes SQLite busy and locked errors', () => {
    expect(isSQLiteContentionError(new Error('database is locked'))).toBe(true);
    expect(isSQLiteContentionError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isSQLiteContentionError(new Error('syntax error'))).toBe(false);
  });

  test('logs slow statements without logging bound values', () => {
    process.env.PLEXUS_SQLITE_SLOW_QUERY_MS = '0.0001';
    const warnSpy = registerSpy(logger, 'warn');
    const database = instrumentSqliteDatabase(new Database(':memory:'));

    database.prepare('SELECT ?').get('secret-value');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SQLite slow query'));
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('secret-value');
    database.close();
  });

  test('logs contention errors from statement execution', () => {
    process.env.PLEXUS_SQLITE_SLOW_QUERY_MS = '250';
    const warnSpy = registerSpy(logger, 'warn');
    const statement = {
      get: (..._args: unknown[]) => {
        throw new Error('database is locked');
      },
    };
    const database = instrumentSqliteDatabase({
      prepare: (..._args: unknown[]) => statement,
      query: (..._args: unknown[]) => statement,
      run: () => undefined,
      exec: () => undefined,
      transaction: () => () => undefined,
    });

    expect(() => database.prepare('SELECT 1').get()).toThrow('database is locked');

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SQLite contention'));
  });

  test('logs transaction execution including transaction modes', () => {
    process.env.PLEXUS_SQLITE_SLOW_QUERY_MS = '0.0001';
    const warnSpy = registerSpy(logger, 'warn');
    const runTransaction = (..._args: unknown[]) => undefined;
    const transaction = Object.assign(runTransaction, {
      deferred: runTransaction,
      immediate: runTransaction,
      exclusive: runTransaction,
    });
    const database = instrumentSqliteDatabase({
      prepare: (..._args: unknown[]) => ({}),
      query: (..._args: unknown[]) => ({}),
      run: () => undefined,
      exec: () => undefined,
      transaction: (..._args: unknown[]) => transaction,
    });

    database.transaction(() => {})();
    database.transaction(() => {}).immediate?.();

    expect(
      warnSpy.mock.calls.filter(([message]: unknown[]) => String(message).includes('transaction'))
    ).toHaveLength(2);
  });

  test('preserves the transaction receiver', () => {
    process.env.PLEXUS_SQLITE_SLOW_QUERY_MS = '250';
    const receiver = { value: 'preserved' };
    let observedReceiver: unknown;
    const runTransaction = function (this: unknown) {
      observedReceiver = this;
    };
    const transaction = Object.assign(runTransaction, {
      deferred: runTransaction,
      immediate: runTransaction,
      exclusive: runTransaction,
    });
    const database = instrumentSqliteDatabase({
      prepare: (..._args: unknown[]) => ({}),
      query: (..._args: unknown[]) => ({}),
      run: () => undefined,
      exec: () => undefined,
      transaction: (..._args: unknown[]) => transaction,
    });
    const wrappedTransaction = database.transaction(() => {});

    wrappedTransaction.call(receiver);

    expect(observedReceiver).toBe(receiver);
  });
});
