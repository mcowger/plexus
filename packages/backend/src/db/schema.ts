/**
 * Unified schema facade.
 *
 * Resolves the active Drizzle schema at runtime so services never need to
 * import both sqlite and postgres schemas and branch on dialect.
 *
 * Keep the physical schema files under drizzle/schema/{sqlite,postgres}
 * intact — those are consumed by drizzle-kit for migration generation.
 */
import * as sqliteSchema from '../../drizzle/schema/sqlite';
import * as postgresSchema from '../../drizzle/schema/postgres';
import { getCurrentDialect } from './client';

export type UnifiedSchema = typeof sqliteSchema | typeof postgresSchema;

let _schema: UnifiedSchema | undefined;

export function getUnifiedSchema(): UnifiedSchema {
  if (!_schema) {
    _schema = getCurrentDialect() === 'postgres' ? postgresSchema : sqliteSchema;
  }
  return _schema;
}

/**
 * Lazily-resolved schema object. Accessing this property triggers a one-time
 * resolution so tests that import the module before initializing the DB do
 * not throw at import time.
 */
export const schema = new Proxy({} as UnifiedSchema, {
  get(_target, prop) {
    return (getUnifiedSchema() as any)[prop];
  },
});

// Re-export for consumers that need the raw dialect-specific modules.
export { sqliteSchema, postgresSchema };
