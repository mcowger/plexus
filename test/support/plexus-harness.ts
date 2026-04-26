import type { Subprocess } from 'bun';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

let plexusProcess: Subprocess | null = null;
let plexusUrl: string | null = null;

const TEST_ADMIN_KEY = 'e2e-test-admin-key';

export interface PlexusConfig {
  /** Base URL for the Anthropic upstream (e.g. fixture server URL) */
  anthropicBaseUrl?: string;
  /** Base URL for the OpenAI upstream (e.g. fixture server URL) */
  openaiBaseUrl?: string;
  /** Anthropic API key (dummy for tests) */
  anthropicApiKey?: string;
  /** OpenAI API key (dummy for tests) */
  openaiApiKey?: string;
  /** Port for Plexus to listen on (default: OS assigns free port) */
  port?: number;
  /** Admin key for the management API (default: 'e2e-test-admin-key') */
  adminKey?: string;
}

/**
 * Start a Plexus instance with test-specific configuration.
 *
 * Plexus is configured entirely through its management API after startup
 * (providers and model aliases are set via PUT endpoints), since provider
 * base URLs and API keys are not configurable via environment variables.
 *
 * Returns the base URL of the running Plexus instance.
 */
export async function startPlexus(config: PlexusConfig = {}): Promise<string> {
  if (plexusProcess) {
    throw new Error('Plexus is already running. Call stopPlexus() first.');
  }

  const port = config.port ?? 0;
  const adminKey = config.adminKey ?? TEST_ADMIN_KEY;

  // Use a temporary directory for the SQLite database so each test run
  // gets a fresh database without conflicting with the dev database.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-e2e-'));
  const dbPath = path.join(tmpDir, 'plexus.db');

  const env = {
    ...process.env,
    ADMIN_KEY: adminKey,
    DATABASE_URL: `sqlite://${dbPath}`,
    NODE_EXTRA_CA_CERTS: path.join(import.meta.dir, '../fixtures/testCA.pem'),
    // Suppress verbose logging during tests
    DEBUG: '',
  };

  if (port !== 0) {
    env.PORT = String(port);
  }
  // When PORT=0, Plexus defaults to 4000. We'll detect the actual port
  // from the startup message. If you need a truly random port, Plexus
  // needs to be patched to support PORT=0 with OS assignment. For now,
  // we use a high port to avoid conflicts.
  if (port === 0) {
    env.PORT = '0';
  }

  plexusProcess = Bun.spawn(['bun', 'run', 'packages/backend/src/index.ts'], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: path.join(import.meta.dir, '../../..'),
  });

  // Wait for Plexus to log its ready message and capture the port
  plexusUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Plexus startup timeout'));
    }, 15000);

    const reader = plexusProcess!.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    async function readLoop() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const match = buffer.match(/Server starting on port (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(`http://localhost:${match[1]}`);
          return;
        }
      }
    }

    readLoop().catch(reject);
  });

  // Configure providers via the management API
  if (config.anthropicBaseUrl) {
    await configureProvider(plexusUrl, adminKey, 'anthropic', {
      api_base_url: config.anthropicBaseUrl,
      api_key: config.anthropicApiKey ?? 'test-dummy-key',
      enabled: true,
    });
  }

  if (config.openaiBaseUrl) {
    await configureProvider(plexusUrl, adminKey, 'openai', {
      api_base_url: config.openaiBaseUrl,
      api_key: config.openaiApiKey ?? 'test-dummy-key',
      enabled: true,
    });
  }

  return plexusUrl;
}

/**
 * Configure a provider via the Plexus management API.
 */
async function configureProvider(
  baseUrl: string,
  adminKey: string,
  slug: string,
  config: Record<string, unknown>
): Promise<void> {
  const response = await fetch(`${baseUrl}/v0/management/providers/${slug}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to configure provider ${slug}: ${response.status} ${body}`);
  }
}

/**
 * Configure a model alias via the Plexus management API.
 */
export async function configureModelAlias(
  baseUrl: string,
  adminKey: string,
  slug: string,
  config: {
    provider: string;
    model: string;
    targets?: Array<{ provider: string; model: string }>;
  }
): Promise<void> {
  const response = await fetch(`${baseUrl}/v0/management/aliases/${slug}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to configure model alias ${slug}: ${response.status} ${body}`);
  }
}

/**
 * Get the admin key used by the test harness.
 */
export function getAdminKey(): string {
  return TEST_ADMIN_KEY;
}

/**
 * Get the base URL of the running Plexus instance.
 * Throws if Plexus is not running.
 */
export function getPlexusUrl(): string {
  if (!plexusUrl) {
    throw new Error('Plexus is not running. Call startPlexus() first.');
  }
  return plexusUrl;
}

/**
 * Stop the running Plexus instance.
 */
export async function stopPlexus(): Promise<void> {
  if (plexusProcess) {
    plexusProcess.kill();
    await plexusProcess.exited;
    plexusProcess = null;
    plexusUrl = null;
  }
}
