import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

const sqliteUrlToPath = (url: string) =>
  url.startsWith('sqlite://') ? url.slice('sqlite://'.length) : null;

function copyDirectory(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

const templateDbUrl = process.env.PLEXUS_TEST_DB_TEMPLATE_URL;
const pgliteTemplateDir = process.env.PLEXUS_TEST_PGLITE_TEMPLATE_DIR;
const tmpRoot = process.env.PLEXUS_TEST_DB_TMP_ROOT;
const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';

if (templateDbUrl && tmpRoot) {
  const templateDbPath = sqliteUrlToPath(templateDbUrl);
  const workerDbPath = path.join(tmpRoot, `vitest-worker-${workerId}.sqlite`);

  if (templateDbPath && !fs.existsSync(workerDbPath)) {
    fs.copyFileSync(templateDbPath, workerDbPath);
  }

  const workerDbUrl = `sqlite://${workerDbPath}`;
  process.env.PLEXUS_TEST_DB_URL = workerDbUrl;
  process.env.DATABASE_URL = workerDbUrl;
} else if (pgliteTemplateDir && tmpRoot) {
  const workerDataDir = path.join(tmpRoot, `vitest-worker-${workerId}.pglite`);

  if (!fs.existsSync(workerDataDir)) {
    copyDirectory(pgliteTemplateDir, workerDataDir);
  }

  const workerDbUrl =
    process.env.PLEXUS_TEST_DB_URL || 'postgres://postgres:postgres@localhost:5432/plexus_test';
  process.env.PLEXUS_POSTGRES_DRIVER = 'pglite';
  process.env.PLEXUS_PGLITE_DATA_DIR = workerDataDir;
  process.env.PLEXUS_TEST_DB_URL = workerDbUrl;
  process.env.DATABASE_URL = workerDbUrl;
} else {
  const testDbUrl = process.env.PLEXUS_TEST_DB_URL;
  if (testDbUrl) {
    process.env.DATABASE_URL = process.env.DATABASE_URL || testDbUrl;
  }
}

const SUPPORTED_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'] as const;

type MockLogLevel = (typeof SUPPORTED_LOG_LEVELS)[number];

const normalizeLogLevel = (value: unknown): MockLogLevel | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (SUPPORTED_LOG_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as MockLogLevel)
    : null;
};

const getStartupLogLevel = (): MockLogLevel => {
  const envLevel = normalizeLogLevel(process.env.LOG_LEVEL);
  if (envLevel) return envLevel;
  if (process.env.DEBUG === 'true') return 'debug';
  return 'info';
};

let currentLogLevel: MockLogLevel = getStartupLogLevel();

const mockLogger = {
  level: currentLogLevel,
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  http: vi.fn(),
  verbose: vi.fn(),
  debug: vi.fn(),
  silly: vi.fn(),
};

// ---------------------------------------------------------------------------
// @mariozechner/pi-ai — single authoritative mock for the whole worker.
//
// With isolate: false every test file shares one module registry.  Letting
// individual test files each register their own vi.mock factory creates a
// last-writer-wins race that breaks whichever file loses.  Registering once
// here (in setupFiles, which runs before any test file) guarantees a stable,
// consistent mock for all consumers.
//
// Rules that every test file must respect:
//   • complete/stream are vi.fn() — use vi.mocked(piAi.complete) to assert on
//     them; re-apply implementations in beforeEach because mockReset: true
//     wipes vi.fn() state between tests.
//   • getModels returns all known test models so quota-error assertions that
//     validate gpt-5.4 is valid for openai-codex always pass.
//   • getModel always includes the `api` field — OAuthTransformer.executeRequest
//     dispatches on model.api and crashes with "No API provider registered"
//     if it is missing.
// ---------------------------------------------------------------------------
vi.mock('@mariozechner/pi-ai', () => ({
  getModels: (provider: string) => {
    if (provider === 'unknown-provider') return [];
    if (provider === 'openai-codex') {
      return [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          contextWindow: 128000,
          provider: 'openai-codex',
          api: 'openai-codex-responses',
        },
      ];
    }
    return [
      {
        id: 'claude-opus-4',
        name: 'Claude Opus 4',
        contextWindow: 200000,
        provider: 'anthropic',
        api: 'anthropic-messages',
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        provider: 'anthropic',
        api: 'anthropic-messages',
      },
      {
        id: 'claude-test',
        name: 'Claude Test',
        contextWindow: 200000,
        provider: 'anthropic',
        api: 'anthropic-messages',
      },
    ];
  },
  getModel: (provider: string, modelId: string) => ({
    id: modelId,
    name: modelId,
    contextWindow: 200000,
    provider,
    api: provider === 'openai-codex' ? 'openai-codex-responses' : 'anthropic-messages',
  }),
  complete: vi.fn(async () => ({
    content: [{ type: 'text', text: 'ok' }],
    stopReason: 'stop',
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    provider: 'anthropic',
    model: 'claude-test',
    timestamp: Date.now(),
  })),
  stream: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../src/utils/logger', () => ({
  logger: mockLogger,
  logEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  StreamTransport: class {},
  SUPPORTED_LOG_LEVELS,
  getStartupLogLevel,
  getCurrentLogLevel: () => currentLogLevel,
  setCurrentLogLevel: (level: string) => {
    const normalized = normalizeLogLevel(level);
    if (!normalized) {
      throw new Error(
        `Invalid log level '${level}'. Supported levels: ${SUPPORTED_LOG_LEVELS.join(', ')}`
      );
    }
    currentLogLevel = normalized;
    mockLogger.level = normalized;
    return normalized;
  },
  resetCurrentLogLevel: () => {
    currentLogLevel = getStartupLogLevel();
    mockLogger.level = currentLogLevel;
    return currentLogLevel;
  },
}));

const { DebugManager } = await import('../src/services/debug-manager');

DebugManager.getInstance().setStorage({
  saveRequest: vi.fn(),
  saveError: vi.fn(),
  saveDebugLog: vi.fn(),
  updatePerformanceMetrics: vi.fn(),
  emitStartedAsync: vi.fn(),
  emitUpdatedAsync: vi.fn(),
  emitStarted: vi.fn(),
  emitUpdated: vi.fn(),
  getDebugLogs: vi.fn(async () => []),
  getDebugLog: vi.fn(async () => null),
  deleteDebugLog: vi.fn(async () => false),
  deleteAllDebugLogs: vi.fn(async () => false),
  getErrors: vi.fn(async () => []),
  deleteError: vi.fn(async () => false),
  deleteAllErrors: vi.fn(async () => false),
  getUsage: vi.fn(async () => ({ data: [], total: 0 })),
  deleteUsageLog: vi.fn(async () => false),
  deleteAllUsageLogs: vi.fn(async () => false),
  deletePerformanceByModel: vi.fn(async () => false),
  recordSuccessfulAttempt: vi.fn(),
  recordFailedAttempt: vi.fn(),
  getProviderPerformance: vi.fn(async () => []),
} as any);
