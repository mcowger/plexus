import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;

/**
 * Resolve a stable, opaque directory for one local MCP server. The name is
 * hashed rather than used as a path component so it can never traverse out of
 * the configured root and does not disclose the server name on disk.
 */
export function getMcpServerDataDir(serverName: string, rootDir?: string): string {
  const root =
    rootDir ??
    process.env.MCP_SERVERS_DATA_DIR ??
    path.join(process.env.DATA_DIR || '/app/data', 'mcp-servers');
  const serverKey = createHash('sha256').update(serverName).digest('hex');
  return path.join(path.resolve(root), serverKey);
}

/** Create or validate a private directory for a local MCP server. */
export function ensureMcpServerDataDir(serverName: string, rootDir?: string): string {
  const directory = getMcpServerDataDir(serverName, rootDir);
  const root = path.dirname(directory);

  mkdirSync(root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const rootInfo = lstatSync(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Local MCP data root is not a directory');
  }
  chmodSync(root, PRIVATE_DIRECTORY_MODE);

  try {
    const existing = lstatSync(directory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error('Local MCP data path is not a directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(directory, { mode: PRIVATE_DIRECTORY_MODE });
  }

  chmodSync(directory, PRIVATE_DIRECTORY_MODE);
  return directory;
}
