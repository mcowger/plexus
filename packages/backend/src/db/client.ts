import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { logger } from '../utils/logger';

type SupportedDialect = 'sqlite' | 'postgres';
type PostgresDriver = 'postgres-js' | 'pglite';

type SqliteDb = ReturnType<typeof drizzle>;
type PostgresJsDb = ReturnType<typeof drizzlePg>;
type PgliteDb = any;

let dbInstance: SqliteDb | PostgresJsDb | PgliteDb | null = null;
let sqlClient: postgres.Sql | null = null;
let pgliteClient: any = null;
const PGLITE_BOOT_EXIT_CODE = 99;
let currentDialect: SupportedDialect | null = null;
let currentSchema: any = null;

function parseConnectionString(uri: string): {
  dialect: SupportedDialect;
  connectionString: string;
} {
  if (uri.startsWith('sqlite://')) {
    let connStr = uri.replace('sqlite://', '');
    // Normalize :memory: path (handles sqlite://:memory: and sqlite://:memory:/)
    if (
      connStr === ':memory:' ||
      connStr === 'memory:' ||
      connStr === ':memory:/' ||
      connStr === 'memory:/'
    ) {
      connStr = ':memory:';
    }
    return { dialect: 'sqlite', connectionString: connStr };
  } else if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
    return { dialect: 'postgres', connectionString: uri };
  }
  throw new Error(`Invalid database URI: must start with sqlite:// or postgres://. Got: ${uri}`);
}

function resolvePath(relPath: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  if (relPath.startsWith('./')) {
    return path.resolve(process.cwd(), relPath);
  }
  const projectRoot = path.resolve(process.cwd(), '../../');
  return path.join(projectRoot, relPath);
}

function getPostgresDriver(): PostgresDriver {
  return process.env.PLEXUS_POSTGRES_DRIVER === 'pglite' ? 'pglite' : 'postgres-js';
}

type PostgresSslOption = false | 'allow' | 'prefer' | 'require' | 'verify-full';

/**
 * Resolve the postgres-js `ssl` option from a PostgreSQL connection string.
 *
 * Previously this was hardcoded to `false`, so a server that requires SSL
 * (for example a managed database with only `hostssl` entries) rejected
 * every connection, no matter what `sslmode` the connection string asked
 * for — the explicit option takes precedence over the URL in postgres-js.
 *
 * The mapping follows libpq's `sslmode`, as understood by postgres-js:
 * no `sslmode` (or `disable`) keeps the previous plaintext behaviour, so
 * local databases without SSL are unaffected. `verify-ca` has no
 * equivalent in postgres-js's `ssl` option type and its runtime would
 * verify the hostname anyway (it always sets `servername`), so it is
 * normalized to `verify-full` rather than silently weakened. As in
 * postgres-js, `sslrootcert=system` upgrades to `verify-full`.
 *
 * An unrecognised `sslmode` throws instead of silently falling back to
 * plaintext, so a typo cannot accidentally downgrade a connection that
 * was meant to be encrypted.
 *
 * A string that `new URL()` cannot parse returns `undefined` instead of
 * `false`: postgres-js accepts connection strings this parser rejects,
 * notably multi-host strings such as
 * `postgres://u:p@h1:5432,h2:5432/db?sslmode=require`, which it parses
 * by rewriting the host before parsing. Returning `false` here would set
 * an explicit `ssl` option and override the URL, silently dropping the
 * requested `sslmode`. The call site therefore omits `ssl` entirely
 * when the result is `undefined` — passing `{ ssl: undefined }` would
 * not work, because postgres-js treats a present `ssl` key as an
 * explicit option even when its value is `undefined`.
 */
export function resolvePostgresSsl(connectionString: string): PostgresSslOption | undefined {
  let sslmode: string | null = null;
  let sslrootcert: string | null = null;
  try {
    const url = new URL(connectionString);
    sslmode = url.searchParams.get('sslmode');
    sslrootcert = url.searchParams.get('sslrootcert');
  } catch {
    // Defer to postgres-js's own parser: do not set an explicit ssl
    // option that would override the sslmode in the connection string.
    return undefined;
  }

  if (sslrootcert === 'system') {
    return 'verify-full';
  }

  if (!sslmode) {
    return false;
  }

  const mode = sslmode.toLowerCase();
  if (mode === 'disable') {
    return false;
  }
  if (mode === 'allow' || mode === 'prefer' || mode === 'require') {
    return mode;
  }
  if (mode === 'verify-ca' || mode === 'verify-full') {
    return 'verify-full';
  }

  throw new Error(
    `Invalid sslmode in database connection string: "${sslmode}". ` +
      'Expected one of: disable, allow, prefer, require, verify-ca, verify-full.'
  );
}

export function initializeDatabase(connectionString?: string) {
  if (dbInstance) {
    logger.silly('Database already initialized, skipping');
    return dbInstance;
  }

  let effectiveUri = connectionString;

  if (!effectiveUri) {
    effectiveUri = process.env.DATABASE_URL;

    if (!effectiveUri) {
      throw new Error('DATABASE_URL environment variable is required for database connection');
    }

    logger.silly(`Using DATABASE_URL: ${effectiveUri.substring(0, 30)}...`);
  }

  const { dialect, connectionString: connStr } = parseConnectionString(effectiveUri);
  currentDialect = dialect;

  logger.silly(`Initializing ${dialect} database...`);

  if (dialect === 'sqlite') {
    const dbPath = connStr === ':memory:' ? ':memory:' : resolvePath(connStr);

    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const sqlite = new Database(dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('PRAGMA foreign_keys = ON');

    const sqliteSchema = require('../../drizzle/schema/sqlite/index');
    const {
      requestUsage,
      providerCooldowns,
      debugLogs,
      inferenceErrors,
      providerPerformance,
      quotaState,
      providers: providersTable,
      providerModels,
      modelAliases,
      modelAliasTargets,
      apiKeys,
      userQuotaDefinitions,
      mcpServers,
      mcpKeys,
      systemSettings,
      oauthCredentials,
      customCheckers,
    } = sqliteSchema;

    currentSchema = sqliteSchema;
    dbInstance = drizzle(sqlite, {
      schema: {
        requestUsage,
        providerCooldowns,
        debugLogs,
        inferenceErrors,
        providerPerformance,
        quotaState,
        providers: providersTable,
        providerModels,
        modelAliases,
        modelAliasTargets,
        apiKeys,
        userQuotaDefinitions,
        mcpServers,
        mcpKeys,
        systemSettings,
        oauthCredentials,
        customCheckers,
      },
    });
  } else {
    const postgresDriver = getPostgresDriver();
    const pgSchema = require('../../drizzle/schema/postgres/index');
    const {
      requestUsage,
      providerCooldowns,
      debugLogs,
      inferenceErrors,
      providerPerformance,
      quotaState,
      providers: providersTable,
      providerModels,
      modelAliases,
      modelAliasTargets,
      apiKeys,
      userQuotaDefinitions,
      mcpServers,
      mcpKeys,
      systemSettings,
      oauthCredentials,
      customCheckers,
    } = pgSchema;

    currentSchema = pgSchema;

    const schema = {
      requestUsage,
      providerCooldowns,
      debugLogs,
      inferenceErrors,
      providerPerformance,
      quotaState,
      providers: providersTable,
      providerModels,
      modelAliases,
      modelAliasTargets,
      apiKeys,
      userQuotaDefinitions,
      mcpServers,
      mcpKeys,
      systemSettings,
      oauthCredentials,
      customCheckers,
    };

    if (postgresDriver === 'pglite') {
      const { PGlite } = require('@electric-sql/pglite');
      const { drizzle: drizzlePglite } = require('drizzle-orm/pglite');
      const dataDir = process.env.PLEXUS_PGLITE_DATA_DIR;
      const previousExitCode = process.exitCode;
      const restoreExitCode = () => {
        if (process.exitCode === PGLITE_BOOT_EXIT_CODE) {
          process.exitCode = previousExitCode ?? 0;
        }
      };
      try {
        pgliteClient = dataDir ? new PGlite(dataDir) : new PGlite();
      } finally {
        restoreExitCode();
      }
      void pgliteClient.waitReady.then(restoreExitCode, () => {});
      dbInstance = drizzlePglite(pgliteClient, {
        schema,
      });
    } else {
      const postgresSsl = resolvePostgresSsl(connStr);
      sqlClient = postgres(connStr, {
        ...(postgresSsl !== undefined ? { ssl: postgresSsl } : {}),
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
        onnotice: () => {},
      });

      // Set statement timeout to prevent long-running queries from blocking
      sqlClient`SET statement_timeout = '30s'`.catch((err) => {
        logger.silly(`Failed to set statement_timeout: ${err}`);
      });

      dbInstance = drizzlePg(sqlClient, {
        schema,
      });
    }
  }

  return dbInstance;
}

export function getDatabase() {
  if (!dbInstance) {
    initializeDatabase();
  }
  return dbInstance as SqliteDb | PostgresJsDb | PgliteDb;
}

export function getSchema() {
  if (!currentSchema) {
    initializeDatabase();
  }
  return currentSchema;
}

export function getCurrentDialect(): SupportedDialect {
  if (!currentDialect) {
    throw new Error('Database not initialized');
  }
  return currentDialect;
}

export async function closeDatabase() {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
  }
  if (pgliteClient) {
    await pgliteClient.close();
    pgliteClient = null;
  }
  dbInstance = null;
}
