/**
 * Statically imports drizzle migration journals so they are bundled into the
 * compiled binary as JavaScript (JSON files are not embedded as file assets by
 * bun --compile; they are transpiled to JS modules instead).
 *
 * SQL migration files are embedded as binary assets (see package.json compile
 * commands with --asset-naming="[name].[ext]") and are accessed at runtime
 * via Bun.embeddedFiles.
 */

import sqliteJournal from '../../drizzle/migrations/meta/_journal.json';
import pgJournal from '../../drizzle/migrations_pg/meta/_journal.json';

export { sqliteJournal, pgJournal };
