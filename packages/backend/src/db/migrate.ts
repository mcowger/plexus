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
const embedded = new Map(
  (Bun.embeddedFiles as EmbeddedFile[]).map((f) => [f.name, f])
);

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

async function readSql(tag: string, devDir: string): Promise<string> {
  const asset = embedded.get(`${tag}.sql`);
  if (asset) return asset.text();
  return Bun.file(path.join(devDir, `${tag}.sql`)).text();
}

async function buildMigrations(journal: Journal, devDir: string): Promise<MigrationMeta[]> {
  return Promise.all(
    journal.entries.map(async (entry) => {
      const content = await readSql(entry.tag, devDir);
      return {
        sql: content.split('--> statement-breakpoint'),
        bps: entry.breakpoints,
        folderMillis: entry.when,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
      };
    })
  );
}

function normalizeSqlStatement(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function isDuplicateColumnError(error: any): boolean {
  return error?.cause?.code === '42701' || error?.code === '42701';
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
      (db as any).dialect.migrate(migrations, (db as any).session, { migrationsFolder: '' });
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
