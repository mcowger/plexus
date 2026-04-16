import { sql } from 'drizzle-orm';
import { getDatabase, getCurrentDialect } from './client';
import { logger } from '../utils/logger';
import crypto from 'node:crypto';
import path from 'node:path';
import sqliteJournal from '../../drizzle/migrations/meta/_journal.json';
import pgJournal from '../../drizzle/migrations_pg/meta/_journal.json';

const DRIZZLE_MIGRATIONS_SCHEMA = 'drizzle';
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';

// Bun types embeddedFiles as Blob[] but the runtime objects are BunFile with a name property.
type EmbeddedFile = Blob & { name: string };

// Populated at startup in a compiled binary; empty when running from source.
const embedded = new Map((Bun.embeddedFiles as EmbeddedFile[]).map((f) => [f.name, f]));

// Filesystem paths used as a fallback in dev/source mode.
const DEV_MIGRATIONS_DIR = {
  sqlite: path.join(import.meta.dir, '../../drizzle/migrations'),
  postgres: path.join(import.meta.dir, '../../drizzle/migrations_pg'),
} as const;

// Shape expected by db.dialect.migrate() — mirrors drizzle-orm's internal MigrationMeta.
interface MigrationMeta {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

type Journal = { entries: Array<{ tag: string; when: number; breakpoints: boolean }> };

async function readSql(
  tag: string,
  devDir: string
): Promise<{ content: string; source: 'embedded' | 'filesystem' }> {
  const asset = embedded.get(`${tag}.sql`);
  if (asset) return { content: await asset.text(), source: 'embedded' };
  return { content: await Bun.file(path.join(devDir, `${tag}.sql`)).text(), source: 'filesystem' };
}

async function buildMigrations(journal: Journal, devDir: string): Promise<MigrationMeta[]> {
  const results = await Promise.all(
    journal.entries.map(async (entry) => {
      const { content, source } = await readSql(entry.tag, devDir);
      return {
        meta: { tag: entry.tag, source },
        migration: {
          sql: content.split('--> statement-breakpoint'),
          bps: entry.breakpoints,
          folderMillis: entry.when,
          hash: crypto.createHash('sha256').update(content).digest('hex'),
        },
      };
    })
  );

  const sources = new Set(results.map((r) => r.meta.source));
  logger.info(
    `Loaded ${results.length} migrations from ${sources.size === 1 ? [...sources][0] : 'mixed'} source`
  );

  return results.map((r) => r.migration);
}

function normalizeSqlStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function isDuplicateColumnError(error: any): boolean {
  return error?.cause?.code === '42701' || error?.code === '42701';
}

function isSQLiteAlreadyExistsError(error: any): boolean {
  const msg = (error?.cause?.message ?? '').toLowerCase();
  return error?.cause?.name === 'SQLiteError' && msg.includes('already exists');
}

function toIdempotentStatement(statement: string): string {
  if (
    /ALTER\s+TABLE[\s\S]+ADD\s+COLUMN/i.test(statement) &&
    !/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i.test(statement)
  ) {
    return statement.replace(/ADD\s+COLUMN\s+/i, 'ADD COLUMN IF NOT EXISTS ');
  }
  return statement;
}

// Make a SQLite DDL statement idempotent by inserting IF NOT EXISTS guards.
// Only handles CREATE TABLE and CREATE [UNIQUE] INDEX — ALTER TABLE ADD COLUMN
// is left unchanged because ADD COLUMN IF NOT EXISTS requires SQLite 3.37.0+
// and may not be available in all compiled binaries. Duplicate-column errors
// from ALTER TABLE are instead caught and ignored in the caller.
function toIdempotentSQLiteStatement(statement: string): string {
  let s = statement;
  s = s.replace(/(CREATE\s+TABLE\s+)(`[\w]+`|\w+)/i, '$1IF NOT EXISTS $2');
  s = s.replace(/(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(`[\w]+`|\w+)/i, '$1IF NOT EXISTS $2');
  return s;
}

function attemptSQLiteAlreadyExistsRepair(
  db: any,
  migrations: MigrationMeta[],
  journal: Journal,
  migrationError: any
): boolean {
  const errorMsg = migrationError?.cause?.message ?? '';
  const nameMatch = errorMsg.match(/(?:table|index)\s+[`']?(\w+)[`']?\s+already exists/i);
  if (!nameMatch) return false;
  const objectName = nameMatch[1]!.toLowerCase();

  // Reach the underlying Bun SQLite Database through the drizzle session
  const sqlite = db?.session?.client;
  if (!sqlite?.run) return false;

  sqlite.run(`
    CREATE TABLE IF NOT EXISTS ${DRIZZLE_MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    )
  `);

  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]!;
    const entry = journal.entries[i]!;
    const statements = migration.sql.map((s) => s.trim()).filter((s) => s.length > 0);

    const refersToObject = statements.some((s) =>
      s.toLowerCase().replace(/\s+/g, ' ').includes(`\`${objectName}\``)
    );
    if (!refersToObject) continue;

    const alreadyApplied = sqlite
      .query(`SELECT id FROM ${DRIZZLE_MIGRATIONS_TABLE} WHERE hash = ?`)
      .get(migration.hash);
    if (alreadyApplied) continue;

    logger.warn(
      `Detected SQLite "already exists" migration drift in ${entry.tag}; applying idempotent repair`
    );

    for (const statement of statements) {
      const idempotent = toIdempotentSQLiteStatement(statement);
      try {
        sqlite.run(idempotent);
      } catch (err: any) {
        const msg = (err?.message ?? '').toLowerCase();
        if (msg.includes('already exists') || msg.includes('duplicate column')) continue;
        throw err;
      }
    }

    // alreadyApplied check above ensures we only reach here when the migration
    // isn't tracked yet, so a plain INSERT is safe.
    sqlite
      .prepare(`INSERT INTO ${DRIZZLE_MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`)
      .run(migration.hash, migration.folderMillis);

    return true;
  }

  return false;
}

async function attemptPostgresDuplicateColumnRepair(
  db: any,
  migrations: MigrationMeta[],
  journal: Journal,
  migrationError: any
): Promise<boolean> {
  const failedQuery = typeof migrationError?.query === 'string' ? migrationError.query : '';
  if (!failedQuery) return false;

  const normalizedFailedQuery = normalizeSqlStatement(failedQuery);

  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]!;
    const entry = journal.entries[i]!;
    const statements = migration.sql.map((s) => s.trim()).filter((s) => s.length > 0);

    if (!statements.some((s) => normalizeSqlStatement(s) === normalizedFailedQuery)) continue;

    logger.warn(
      `Detected duplicate-column migration drift in ${entry.tag}; applying idempotent repair`
    );

    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"`));
    await db.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `)
    );

    for (const statement of statements) {
      const repairedStatement = toIdempotentStatement(statement);
      try {
        await db.execute(sql.raw(repairedStatement));
      } catch (statementError: any) {
        if (
          /ALTER\s+TABLE[\s\S]+ADD\s+COLUMN/i.test(repairedStatement) &&
          isDuplicateColumnError(statementError)
        )
          continue;
        throw statementError;
      }
    }

    await db.execute(
      sql.raw(`
        INSERT INTO "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" ("hash", "created_at")
        SELECT '${migration.hash}', ${migration.folderMillis}
        WHERE NOT EXISTS (
          SELECT 1 FROM "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}"
          WHERE "created_at" = ${migration.folderMillis}
        )
      `)
    );

    return true;
  }

  return false;
}

export async function runMigrations() {
  try {
    const db = getDatabase();
    const dialect = getCurrentDialect();

    logger.info(`Running ${dialect} migrations...`);

    if (dialect === 'sqlite') {
      const migrations = await buildMigrations(sqliteJournal as Journal, DEV_MIGRATIONS_DIR.sqlite);
      try {
        (db as any).dialect.migrate(migrations, (db as any).session, { migrationsFolder: '' });
      } catch (error: any) {
        if (isSQLiteAlreadyExistsError(error)) {
          const repaired = attemptSQLiteAlreadyExistsRepair(
            db,
            migrations,
            sqliteJournal as Journal,
            error
          );
          if (repaired) {
            logger.warn('Retrying SQLite migrations after already-exists repair');
            (db as any).dialect.migrate(migrations, (db as any).session, { migrationsFolder: '' });
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } else {
      const migrations = await buildMigrations(pgJournal as Journal, DEV_MIGRATIONS_DIR.postgres);
      try {
        await (db as any).dialect.migrate(migrations, (db as any).session, {
          migrationsFolder: '',
          migrationsSchema: DRIZZLE_MIGRATIONS_SCHEMA,
          migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
        });
      } catch (error: any) {
        if (isDuplicateColumnError(error)) {
          const repaired = await attemptPostgresDuplicateColumnRepair(
            db,
            migrations,
            pgJournal as Journal,
            error
          );
          if (repaired) {
            logger.warn('Retrying PostgreSQL migrations after duplicate-column repair');
            await (db as any).dialect.migrate(migrations, (db as any).session, {
              migrationsFolder: '',
              migrationsSchema: DRIZZLE_MIGRATIONS_SCHEMA,
              migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
            });
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    logger.info('Migrations completed successfully');
  } catch (error: any) {
    logger.error('Migration failed', error);
    throw error;
  }
}
