import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getCurrentLogLevel, logger } from '../utils/logger';
import path from 'node:path';
import fs from 'node:fs';

type SupportedDialect = 'sqlite' | 'postgres';
type PostgresDriver = 'postgres-js' | 'pglite';

type SqliteDb = ReturnType<typeof drizzle>;
type PostgresJsDb = ReturnType<typeof drizzlePg>;
type PgliteDb = any;

let dbInstance: SqliteDb | PostgresJsDb | PgliteDb | null = null;
let sqlClient: postgres.Sql | null = null;
let pgliteClient: any = null;
let currentDialect: SupportedDialect | null = null;
let currentSchema: any = null;

function createDrizzleLogger() {
  return {
    logQuery(query: string, params: unknown[]) {
      if (getCurrentLogLevel() === 'silly') {
        logger.silly(`Query: ${query}`);
      }
    },
  };
}

function parseConnectionString(uri: string): {
  dialect: SupportedDialect;
  connectionString: string;
} {
  if (uri.startsWith('sqlite://')) {
    return { dialect: 'sqlite', connectionString: uri.replace('sqlite://', '') };
  } else if (uri.startsWith('postgres://') || uri.startsWith('postgresql://')) {
    return { dialect: 'postgres', connectionString: uri };
  }
  throw new Error(`Invalid database URI: must start with sqlite:// or postgres://. Got: ${uri}`);
}

function resolvePath(relPath: string): string {
  if (relPath.startsWith('/')) return relPath;
  if (relPath.startsWith('./')) {
    return path.resolve(process.cwd(), relPath);
  }
  const projectRoot = path.resolve(process.cwd(), '../../');
  return path.join(projectRoot, relPath);
}

function getPostgresDriver(): PostgresDriver {
  return process.env.PLEXUS_POSTGRES_DRIVER === 'pglite' ? 'pglite' : 'postgres-js';
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
      systemSettings,
      oauthCredentials,
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
        systemSettings,
        oauthCredentials,
      },
      logger: createDrizzleLogger(),
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
      systemSettings,
      oauthCredentials,
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
      systemSettings,
      oauthCredentials,
    };

    if (postgresDriver === 'pglite') {
      const { PGlite } = require('@electric-sql/pglite');
      const { drizzle: drizzlePglite } = require('drizzle-orm/pglite');
      const dataDir = process.env.PLEXUS_PGLITE_DATA_DIR;
      pgliteClient = dataDir ? new PGlite(dataDir) : new PGlite();
      dbInstance = drizzlePglite(pgliteClient, {
        schema,
        logger: createDrizzleLogger(),
      });
    } else {
      sqlClient = postgres(connStr, {
        ssl: false,
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
        logger: createDrizzleLogger(),
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
