import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { basename } from 'path';

export const DEFAULT_FRPC_SERVER_PORT = 7000;

const MAX_DNS_LABEL_LENGTH = 63;
const LONG_LABEL_HASH_LENGTH = 8;

export function sanitizeDnsLabel(value: string, fallback: string): string {
  const label = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return label || fallback;
}

export function repositoryNameFromRemote(remote: string): string {
  const trimmed = remote
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/i, '');
  return trimmed.split(/[/:]/).pop() || 'repo';
}

export function getRepositoryName(cwd = process.cwd()): string {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return repositoryNameFromRemote(remote);
  } catch {
    return basename(cwd);
  }
}

export function isFrpcAvailable(): boolean {
  try {
    execFileSync('frpc', ['--version'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function buildFrpcSubdomain(repositoryName: string, worktreeName: string): string {
  const base = `${sanitizeDnsLabel(repositoryName, 'repo')}-${sanitizeDnsLabel(worktreeName, 'worktree')}`;
  if (base.length <= MAX_DNS_LABEL_LENGTH) return base;

  const hash = createHash('sha256')
    .update(`${repositoryName}\0${worktreeName}`)
    .digest('hex')
    .slice(0, LONG_LABEL_HASH_LENGTH);
  const prefix = base
    .slice(0, MAX_DNS_LABEL_LENGTH - LONG_LABEL_HASH_LENGTH - 1)
    .replace(/-+$/, '');
  return `${prefix}-${hash}`;
}

export function buildFrpcUrl(subdomain: string, subdomainHost?: string): string | undefined {
  const host = subdomainHost?.trim().replace(/\.$/, '');
  return host ? `https://${subdomain}.${host}` : undefined;
}

export interface FrpcProxyOptions {
  serverAddr: string;
  serverPort: number;
  token: string;
  proxyName: string;
  localPort: number;
  subdomain: string;
}

export function buildFrpcArgs(options: FrpcProxyOptions): string[] {
  return [
    'http',
    '--server-addr',
    options.serverAddr,
    '--server-port',
    String(options.serverPort),
    '--token',
    options.token,
    '--proxy-name',
    options.proxyName,
    '--local-ip',
    '127.0.0.1',
    '--local-port',
    String(options.localPort),
    '--sd',
    options.subdomain,
  ];
}
