/**
 * BackupService — Full database backup and restore.
 *
 * Two modes:
 *   1. Config-only JSON (small, fast — most common need)
 *   2. Full archive (.tar.gz) with config JSON + per-table CSV for operational data
 *
 * All data is normalised to a dialect-agnostic format:
 *   - Timestamps become ISO 8601 strings
 *   - Boolean integers become true/false
 *   - BigInt numbers become JSON numbers
 *
 * Sensitive fields (API key secrets, OAuth tokens) are decrypted on export
 * and re-encrypted on import so the backup is portable across instances
 * with different ENCRYPTION_KEY values.
 */

import { getDatabase, getSchema, getCurrentDialect } from '../../db/client';
import { ConfigService } from './config-service';
import { ConfigRepository, McpKeyConfig, OAuthCredentialsData } from '../../db/config-repository';
import { logger } from '../../utils/logger';
import { decrypt, encrypt } from '../../utils/encryption';
import { parse as parseCsvSync } from 'csv-parse/sync';

// ─── Types ────────────────────────────────────────────────────────────

/** Schema version for forward-compatible migration. */
const BACKUP_VERSION = 1;

/** Sentinel for NULL values in CSV. Empty strings are preserved as-is. */
const NULL_SENTINEL = '\\N';

/** The config-only JSON envelope returned by GET /backup. */
export interface ConfigBackupEnvelope {
  plexus_backup: true;
  version: number;
  created_at: string;
  dialect: 'sqlite' | 'postgres';
  data: ConfigBackupData;
}

/** Config tables — same shape as ConfigService.exportConfig() plus oauth creds. */
export interface ConfigBackupData {
  providers: Record<string, unknown>;
  models: Record<string, unknown>;
  keys: Record<string, unknown>;
  user_quotas: Record<string, unknown>;
  mcp_servers: Record<string, unknown>;
  mcp_keys?: McpKeyConfig[];
  settings: Record<string, unknown>;
  oauth_credentials: Array<{
    provider_type: string;
    account_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  }>;
}

/** Summary of what was restored. */
export interface RestoreResult {
  success: true;
  restored: Record<string, number>;
  message: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────

/**
 * Escape a value for CSV. Handles nulls, embedded quotes, commas, and newlines.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return NULL_SENTINEL;
  const str = String(value);
  if (str === NULL_SENTINEL) return '"' + NULL_SENTINEL + '"'; // Escape accidental sentinel
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert a drizzle row to a CSV line. Columns are in the order of `columns`.
 */
function rowToCsvLine(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((col) => csvEscape(row[col])).join(',');
}

/**
 * Normalise a row value for CSV output:
 *   - Date objects → ISO 8601 string
 *   - BigInt → number
 *   - boolean integer (0/1) → "true"/"false" for known boolean columns
 *   - null/undefined → empty string
 */
function normaliseForCsv(
  row: Record<string, unknown>,
  booleanColumns: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (booleanColumns.has(key) && typeof value === 'number') {
      out[key] = value === 1 ? 'true' : 'false';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Parse a CSV value back into its typed form for DB insertion.
 *   - "true"/"false" for boolean columns → 1/0 (sqlite) or true/false (postgres)
 *   - ISO 8601 date strings for timestamp columns → appropriate DB type
 *   - Empty string → null
 */
function csvValueToDb(
  value: string,
  colName: string,
  booleanColumns: Set<string>,
  timestampMsColumns: Set<string>,
  timestampTextColumns: Set<string>,
  dialect: 'sqlite' | 'postgres'
): unknown {
  if (value === NULL_SENTINEL) return null;
  if (value === '') return '';

  if (booleanColumns.has(colName)) {
    if (value === 'true') return dialect === 'sqlite' ? 1 : true;
    if (value === 'false') return dialect === 'sqlite' ? 0 : false;
    const num = Number(value);
    if (!Number.isNaN(num)) return dialect === 'sqlite' ? (num ? 1 : 0) : Boolean(num);
    return value;
  }

  if (timestampTextColumns.has(colName)) {
    // These become ISO strings on sqlite, Date objects on postgres
    return dialect === 'postgres' ? new Date(value) : value;
  }

  if (timestampMsColumns.has(colName)) {
    // These become Date objects on sqlite (timestamp_ms mode), numbers on postgres (bigint)
    const ms = new Date(value).getTime();
    return dialect === 'sqlite' ? new Date(ms) : ms;
  }

  // Try to parse numbers that were originally integers but read as strings from CSV
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '' && !/^0\d/.test(value.trim())) {
    // Heuristic: if it looks like a pure number, return as number
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
      return Number(value);
    }
  }

  return value;
}

// ─── Archive support ─────────────────────────────────────────────────

async function buildBunArchive(files: Map<string, Buffer>): Promise<Buffer> {
  const archive = new Bun.Archive(Object.fromEntries(files), { compress: 'gzip' });
  return Buffer.from(await archive.bytes());
}

async function readBunArchive(data: Buffer): Promise<Map<string, Buffer>> {
  const archiveFiles = await new Bun.Archive(data).files();
  const files = new Map<string, Buffer>();

  for (const [name, file] of archiveFiles) {
    files.set(name, Buffer.from(await file.arrayBuffer()));
  }

  return files;
}

// ─── Column metadata per operational table ──────────────────────────

/**
 * Define the boolean / timestamp columns for each operational table
 * so the CSV serialiser/deserialiser can normalise them correctly.
 */
const TABLE_META: Record<
  string,
  {
    booleanCols: string[];
    timestampMsCols: string[];
    timestampTextCols: string[];
  }
> = {
  request_usage: {
    booleanCols: ['isStreamed', 'isPassthrough', 'isVisionFallthrough', 'isDescriptorRequest'],
    timestampMsCols: [],
    timestampTextCols: ['date'], // SQLite text, PG text (already strings)
  },
  provider_cooldowns: {
    booleanCols: [],
    timestampMsCols: [], // expiry/createdAt are plain integer, not timestamp_ms
    timestampTextCols: [],
  },
  debug_logs: {
    booleanCols: [],
    timestampMsCols: [], // createdAt is plain integer, not timestamp_ms
    timestampTextCols: [],
  },
  inference_errors: {
    booleanCols: [],
    timestampMsCols: [], // createdAt is plain integer, not timestamp_ms
    timestampTextCols: ['date'],
  },
  provider_performance: {
    booleanCols: [],
    timestampMsCols: [], // createdAt is plain integer, not timestamp_ms
    timestampTextCols: [],
  },
  quota_state: {
    booleanCols: [],
    timestampMsCols: ['lastUpdated', 'windowStart'],
    timestampTextCols: [],
  },
  meter_snapshots: {
    booleanCols: ['success'],
    timestampMsCols: ['resetsAt', 'checkedAt', 'createdAt'],
    timestampTextCols: [],
  },
  quota_snapshots: {
    booleanCols: [],
    timestampMsCols: ['checkedAt', 'resetsAt', 'createdAt'],
    timestampTextCols: [],
  },
  mcp_request_usage: {
    booleanCols: ['isStreamed', 'hasDebug'],
    timestampMsCols: [],
    timestampTextCols: ['createdAt'],
  },
  mcp_debug_logs: {
    booleanCols: [],
    timestampMsCols: [],
    timestampTextCols: ['createdAt'],
  },
  responses: {
    booleanCols: [],
    timestampMsCols: [], // createdAt/completedAt are plain integer, not timestamp_ms
    timestampTextCols: [],
  },
  conversations: {
    booleanCols: [],
    timestampMsCols: [], // createdAt/updatedAt are plain integer, not timestamp_ms
    timestampTextCols: [],
  },
  response_items: {
    booleanCols: [],
    timestampMsCols: [],
    timestampTextCols: [],
  },
};

// Operational tables in insertion order (respecting FK dependencies)
const OPERATIONAL_TABLES = [
  'request_usage',
  'provider_cooldowns',
  'debug_logs',
  'inference_errors',
  'provider_performance',
  'quota_state',
  'meter_snapshots',
  'quota_snapshots',
  'mcp_request_usage',
  'mcp_debug_logs',
  'responses',
  'conversations',
  'response_items',
] as const;

// ─── BackupService ──────────────────────────────────────────────────

export class BackupService {
  /**
   * Export config-only backup as a JSON envelope.
   */
  async exportConfigBackup(): Promise<ConfigBackupEnvelope> {
    const dialect = getCurrentDialect();
    const configService = ConfigService.getInstance();
    const configData = await configService.exportConfig();

    // Augment with decrypted OAuth credentials
    const repo = configService.getRepository();
    const oauthProviders = await repo.getAllOAuthProviders();
    const oauthCredentials: ConfigBackupData['oauth_credentials'] = [];

    for (const { providerType, accountId } of oauthProviders) {
      const creds = await repo.getOAuthCredentials(providerType, accountId);
      if (creds) {
        oauthCredentials.push({
          provider_type: providerType,
          account_id: accountId,
          access_token: creds.accessToken,
          refresh_token: creds.refreshToken,
          expires_at: creds.expiresAt,
        });
      }
    }

    return {
      plexus_backup: true,
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      dialect,
      data: {
        providers: configData.providers as Record<string, unknown>,
        models: configData.models as Record<string, unknown>,
        keys: configData.keys as Record<string, unknown>,
        user_quotas: configData.user_quotas as Record<string, unknown>,
        mcp_servers: configData.mcp_servers as Record<string, unknown>,
        mcp_keys: configData.mcp_keys as McpKeyConfig[],
        settings: configData.settings as Record<string, unknown>,
        oauth_credentials: oauthCredentials,
      },
    };
  }

  /**
   * Export full backup as a gzipped tar archive.
   * Contains manifest.json (version info) + config.json + per-table .csv files.
   */
  async exportFullBackup(): Promise<Buffer> {
    const dialect = getCurrentDialect();
    const db = getDatabase();
    const schema = getSchema();

    const files = new Map<string, Buffer>();

    // manifest.json
    const manifest = {
      plexus_backup: true,
      version: BACKUP_VERSION,
      created_at: new Date().toISOString(),
      dialect,
      tables: OPERATIONAL_TABLES,
    };
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    // config.json — reuse config-only export
    const configBackup = await this.exportConfigBackup();
    files.set('config.json', Buffer.from(JSON.stringify(configBackup.data, null, 2), 'utf8'));

    // Operational tables → CSV
    const schemaMap = this.getSchemaTableMap();

    for (const tableName of OPERATIONAL_TABLES) {
      const table = schemaMap[tableName as keyof typeof schemaMap];
      if (!table) {
        logger.warn(`[Backup] Table ${tableName} not found in schema, skipping`);
        continue;
      }

      const rows = await db.select().from(table);
      if (rows.length === 0) {
        files.set(`${tableName}.csv`, Buffer.from('', 'utf8'));
        continue;
      }

      const meta = TABLE_META[tableName] ?? {
        booleanCols: [],
        timestampMsCols: [],
        timestampTextCols: [],
      };
      const booleanCols = new Set(meta.booleanCols);
      const columns = Object.keys(rows[0]!);

      const lines: string[] = [columns.join(',')];
      for (const rawRow of rows) {
        const row = normaliseForCsv(rawRow as Record<string, unknown>, booleanCols);
        lines.push(rowToCsvLine(row, columns));
      }

      // Gzip the CSV content
      const csvContent = Buffer.from(lines.join('\n'), 'utf8');
      const gzipped = Bun.gzipSync(csvContent);
      files.set(`${tableName}.csv.gz`, Buffer.from(gzipped));

      logger.debug(`[Backup] Exported ${tableName}: ${rows.length} rows`);
    }

    // Build tar and gzip the whole archive
    return buildBunArchive(files);
  }

  /**
   * Restore from a config-only JSON envelope.
   */
  async restoreConfigBackup(data: ConfigBackupEnvelope): Promise<RestoreResult> {
    if (!data.plexus_backup) throw new Error('Not a valid Plexus backup file');
    if (data.version !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version ${data.version} (expected ${BACKUP_VERSION})`);
    }

    const dialect = getCurrentDialect();
    const configService = ConfigService.getInstance();
    const repo = configService.getRepository();
    const counts: Record<string, number> = {};

    // Wipe all config data
    await repo.clearAllData();
    counts['_cleared'] = 1;

    // Providers
    const providers = data.data.providers as Record<string, any>;
    for (const [slug, config] of Object.entries(providers)) {
      await repo.saveProvider(slug, config);
    }
    counts['providers'] = Object.keys(providers).length;

    // Model aliases
    const models = data.data.models as Record<string, any>;
    for (const [slug, config] of Object.entries(models)) {
      await repo.saveAlias(slug, config);
    }
    counts['model_aliases'] = Object.keys(models).length;

    // API keys
    const keys = data.data.keys as Record<string, any>;
    for (const [name, config] of Object.entries(keys)) {
      await repo.saveKey(name, config);
    }
    counts['api_keys'] = Object.keys(keys).length;

    // User quotas
    const userQuotas = data.data.user_quotas as Record<string, any>;
    for (const [name, config] of Object.entries(userQuotas)) {
      await repo.saveUserQuota(name, config);
    }
    counts['user_quotas'] = Object.keys(userQuotas).length;

    // MCP servers
    const mcpServers = data.data.mcp_servers as Record<string, any>;
    for (const [name, config] of Object.entries(mcpServers)) {
      await repo.saveMcpServer(name, config);
    }
    counts['mcp_servers'] = Object.keys(mcpServers).length;

    // MCP keys reference MCP servers, so restore them only after all servers exist.
    const mcpKeys = data.data.mcp_keys ?? [];
    await repo.batchInsertMcpKeys(mcpKeys);
    counts['mcp_keys'] = mcpKeys.length;

    // System settings
    const settings = data.data.settings as Record<string, unknown>;
    await repo.setSettingsBulk(settings);
    counts['system_settings'] = Object.keys(settings).length;

    // OAuth credentials
    const oauthCreds = data.data.oauth_credentials ?? [];
    for (const cred of oauthCreds) {
      await repo.setOAuthCredentials(cred.provider_type, cred.account_id, {
        accessToken: cred.access_token,
        refreshToken: cred.refresh_token,
        expiresAt: cred.expires_at,
      });
    }
    counts['oauth_credentials'] = oauthCreds.length;

    // Rebuild cache
    await configService.initialize();

    return {
      success: true,
      restored: counts,
      message: 'Config restore complete. Server is restarting to apply changes.',
    };
  }

  /**
   * Restore from a full backup archive (.tar.gz).
   * Also accepts a config-only JSON envelope (auto-detected).
   */
  async restoreFullBackup(body: Buffer | Record<string, unknown>): Promise<RestoreResult> {
    // Detect format
    if (Buffer.isBuffer(body)) {
      return this.restoreFromArchive(body);
    }

    // JSON envelope
    const data = body as unknown as ConfigBackupEnvelope;
    return this.restoreConfigBackup(data);
  }

  /**
   * Restore from a gzipped tar archive.
   */
  private async restoreFromArchive(data: Buffer): Promise<RestoreResult> {
    const files = await readBunArchive(data);

    // Validate manifest
    const manifestBuf = files.get('manifest.json');
    if (!manifestBuf) throw new Error('Invalid backup archive: missing manifest.json');

    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    if (!manifest.plexus_backup) throw new Error('Not a valid Plexus backup archive');
    if (manifest.version !== BACKUP_VERSION) {
      throw new Error(
        `Unsupported backup version ${manifest.version} (expected ${BACKUP_VERSION})`
      );
    }

    // Restore config first
    const configBuf = files.get('config.json');
    if (!configBuf) throw new Error('Invalid backup archive: missing config.json');

    const configData: ConfigBackupData = JSON.parse(configBuf.toString('utf8'));
    const configEnvelope: ConfigBackupEnvelope = {
      plexus_backup: true,
      version: manifest.version,
      created_at: manifest.created_at,
      dialect: manifest.dialect,
      data: configData,
    };

    const configResult = await this.restoreConfigBackup(configEnvelope);
    const counts = { ...configResult.restored };

    // Now restore operational tables
    const db = getDatabase();
    const schema = getSchema();
    const dialect = getCurrentDialect();
    const schemaMap = this.getSchemaTableMap();

    // Wipe operational tables (in reverse insertion order to respect FKs)
    for (let i = OPERATIONAL_TABLES.length - 1; i >= 0; i--) {
      const tableName = OPERATIONAL_TABLES[i];
      const table = schemaMap[tableName as keyof typeof schemaMap];
      if (table) {
        try {
          await db.delete(table);
        } catch (e) {
          logger.warn(`[Backup] Failed to clear ${tableName}: ${e}`);
        }
      }
    }

    // Insert operational data from CSV files
    for (const tableName of OPERATIONAL_TABLES) {
      const csvGz = files.get(`${tableName}.csv.gz`);
      const csvPlain = files.get(`${tableName}.csv`);
      const fileData = csvGz ?? csvPlain;

      if (!fileData) {
        logger.debug(`[Backup] No data for ${tableName}, skipping`);
        counts[tableName] = 0;
        continue;
      }

      const table = schemaMap[tableName as keyof typeof schemaMap];
      if (!table) {
        logger.warn(`[Backup] Table ${tableName} not found in schema, skipping`);
        continue;
      }

      // Decompress if needed
      let csvBuffer: Buffer;
      if (csvGz) {
        csvBuffer = Buffer.from(Bun.gunzipSync(new Uint8Array(fileData)));
      } else {
        csvBuffer = fileData;
      }

      const csvText = csvBuffer.toString('utf8').trim();
      if (!csvText) {
        counts[tableName] = 0;
        continue;
      }

      const meta = TABLE_META[tableName] ?? {
        booleanCols: [],
        timestampMsCols: [],
        timestampTextCols: [],
      };
      const booleanCols = new Set(meta.booleanCols);
      const timestampMsCols = new Set(meta.timestampMsCols);
      const timestampTextCols = new Set(meta.timestampTextCols);

      // Parse CSV with proper handling of quoted multi-line fields
      // (JSON blobs in debug_logs, inference_errors, etc. contain newlines)
      let records: Record<string, string>[];
      try {
        records = parseCsvSync(csvText, {
          columns: true, // first row = header → objects keyed by column name
          skip_empty_lines: true,
          relax_column_count: true, // tolerate rows with fewer columns
          trim: false, // don't trim — values may have significant whitespace
        });
      } catch (parseErr) {
        logger.error(`[Backup] CSV parse failed for ${tableName}: ${parseErr}`);
        throw new Error(`Failed to parse ${tableName}.csv: ${parseErr}`);
      }

      if (records.length === 0) {
        counts[tableName] = 0;
        continue;
      }

      let inserted = 0;

      // Batch insert in chunks of 500
      const batchSize = 500;
      let batch: Record<string, unknown>[] = [];

      for (const record of records) {
        const row: Record<string, unknown> = {};
        for (const [col, val] of Object.entries(record)) {
          row[col] = csvValueToDb(
            val ?? '',
            col,
            booleanCols,
            timestampMsCols,
            timestampTextCols,
            dialect
          );
        }

        batch.push(row);
        if (batch.length >= batchSize) {
          try {
            await db.insert(table).values(batch);
            inserted += batch.length;
          } catch (e) {
            logger.warn(`[Backup] Batch insert failed for ${tableName}: ${e}`);
          }
          batch = [];
        }
      }

      // Flush remaining
      if (batch.length > 0) {
        try {
          await db.insert(table).values(batch);
          inserted += batch.length;
        } catch (e) {
          logger.warn(`[Backup] Final batch insert failed for ${tableName}: ${e}`);
        }
      }

      counts[tableName] = inserted;
      logger.debug(`[Backup] Restored ${tableName}: ${inserted} rows`);
    }

    return {
      success: true,
      restored: counts,
      message: 'Full restore complete. Server is restarting to apply changes.',
    };
  }

  /**
   * Map of table name → drizzle table object from the current schema.
   */
  private getSchemaTableMap(): Record<string, any> {
    const schema = getSchema();
    return {
      request_usage: schema.requestUsage,
      provider_cooldowns: schema.providerCooldowns,
      debug_logs: schema.debugLogs,
      inference_errors: schema.inferenceErrors,
      provider_performance: schema.providerPerformance,
      quota_state: schema.quotaState,
      meter_snapshots: schema.meterSnapshots,
      quota_snapshots: schema.quotaSnapshots,
      mcp_request_usage: schema.mcpRequestUsage,
      mcp_debug_logs: schema.mcpDebugLogs,
      responses: schema.responses,
      conversations: schema.conversations ?? null,
      response_items: schema.responseItems ?? null,
    };
  }
}

// ─── CSV Parsing ─────────────────────────────────────────────────────

// parseCsvLine removed — replaced by csv-parse/sync which handles
// multi-line quoted fields correctly (e.g. JSON blobs in debug data)
