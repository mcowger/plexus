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

const testDialect = process.env.PLEXUS_TEST_DIALECT;
const sqliteTemplateDbUrl = process.env.PLEXUS_TEST_SQLITE_TEMPLATE_URL;
const sqliteTmpRoot = process.env.PLEXUS_TEST_SQLITE_TMP_ROOT;
const postgresTemplateDir = process.env.PLEXUS_TEST_POSTGRES_TEMPLATE_DIR;
const postgresTmpRoot = process.env.PLEXUS_TEST_POSTGRES_TMP_ROOT;
const workerId = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';

if ((testDialect === 'sqlite' || testDialect === 'unit') && sqliteTemplateDbUrl && sqliteTmpRoot) {
  const templateDbPath = sqliteUrlToPath(sqliteTemplateDbUrl);
  const workerPrefix = testDialect === 'unit' ? 'vitest-unit-worker' : 'vitest-worker';
  const workerDbPath = path.join(sqliteTmpRoot, `${workerPrefix}-${workerId}.sqlite`);

  if (templateDbPath && !fs.existsSync(workerDbPath)) {
    fs.copyFileSync(templateDbPath, workerDbPath);
  }

  const workerDbUrl = `sqlite://${workerDbPath}`;
  process.env.PLEXUS_TEST_DB_URL = workerDbUrl;
  process.env.DATABASE_URL = workerDbUrl;
} else if (testDialect === 'postgres' && postgresTemplateDir && postgresTmpRoot) {
  const workerDataDir = path.join(postgresTmpRoot, `vitest-worker-${workerId}.pglite`);

  if (!fs.existsSync(workerDataDir)) {
    copyDirectory(postgresTemplateDir, workerDataDir);
  }

  const workerDbUrl =
    process.env.PLEXUS_TEST_POSTGRES_DB_URL ||
    'postgres://postgres:postgres@localhost:5432/plexus_test';
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
const mockComplete = vi.fn(async () => ({
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'stop',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  provider: 'anthropic',
  model: 'claude-test',
  timestamp: Date.now(),
}));

const mockStream = vi.fn(async () => ({ ok: true }));

const mockGetModels = (provider: string) => {
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
      {
        id: 'gpt-5.5',
        name: 'GPT-5.5',
        contextWindow: 128000,
        provider: 'openai-codex',
        api: 'openai-codex-responses',
      },
    ];
  }
  if (provider === 'github-copilot') {
    // Copilot really does serve GPT-5.x alongside Claude models (matches the
    // bundled pi-ai registry); list both so model-support checks are accurate.
    return [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        contextWindow: 128000,
        provider: 'github-copilot',
        api: 'openai-responses',
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        contextWindow: 200000,
        provider: 'github-copilot',
        api: 'anthropic-messages',
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
};

const mockGetModel = (provider: string, modelId: string) => {
  let api = 'anthropic-messages';
  if (provider === 'openai-codex') {
    api = 'openai-codex-responses';
  } else if (provider === 'github-copilot') {
    // Copilot is multi-API: resolve the wire API per model id so
    // copilotWireApiType() can map chat/messages/responses in tests.
    if (modelId.includes('claude')) api = 'anthropic-messages';
    else if (modelId === 'gpt-5.4' || modelId.includes('responses')) api = 'openai-responses';
    else api = 'openai-completions';
  }
  // GPT-5.6-style reasoning model with a gpt-5.6 thinkingLevelMap, mirroring
  // the real pi-ai openai-responses catalog (minimal unsupported, off = none).
  if (modelId.startsWith('gpt-5.6')) {
    return {
      id: modelId,
      name: modelId,
      contextWindow: 400000,
      provider,
      api: 'openai-responses',
      reasoning: true,
      thinkingLevelMap: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
    };
  }
  return {
    id: modelId,
    name: modelId,
    contextWindow: 200000,
    provider,
    api,
    // Copilot resolves its real baseURL from the token proxy-ep at request time;
    // the registry baseUrl is only a fallback. Other providers keep none here so
    // their own resolvers/defaults apply (e.g. Codex → chatgpt.com backend).
    ...(provider === 'github-copilot'
      ? { baseUrl: 'https://api.individual.githubcopilot.com' }
      : {}),
  };
};

const mockGetProviders = () => ['anthropic', 'openai-codex', 'openai', 'google'];

// Faithful port of pi-ai's getSupportedThinkingLevels: honours model.reasoning
// and thinkingLevelMap ('null' = unsupported; xhigh/max require an explicit
// entry) so reasoning-capability assertions track the model record under test.
const EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const mockGetSupportedThinkingLevels = (model: any) => {
  if (!model?.reasoning) return ['off'];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
};

// @earendil-works/pi-ai — single authoritative mock for the whole worker.
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
//     validate gpt-5.4/gpt-5.5 are valid for openai-codex always pass.
//   • getModel always includes the `api` field — OAuthTransformer.executeRequest
//     dispatches on model.api and crashes with \"No API provider registered\"
//     if it is missing.
// ---------------------------------------------------------------------------
vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>();
  return {
    complete: mockModels.complete,
    stream: mockModels.stream,
    calculateCost: vi.fn(() => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })),
    clampThinkingLevel: (_m: any, l: string) => l,
    getSupportedThinkingLevels: mockGetSupportedThinkingLevels,
    // The model catalog overlay delegates merge/restore/persist to pi-ai's
    // real createProvider — keep it real so catalog tests exercise genuine
    // library semantics.
    createProvider: actual.createProvider,
  };
});

vi.mock('@earendil-works/pi-ai/providers/all', () => ({
  builtinModels: () => mockModels,
  getBuiltinModel: mockGetModel,
  getBuiltinModels: mockGetModels,
  getBuiltinProviders: mockGetProviders,
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  complete: mockComplete,
  stream: mockStream,
  getModels: mockGetModels,
  getModel: mockGetModel,
  getProviders: mockGetProviders,
}));

const MOCK_BUILTIN_PROVIDER_IDS = new Set(['anthropic', 'openai-codex', 'openai', 'google']);

// Mirrors which real pi-ai builtin providers expose `auth.oauth` — kept in
// sync with services/oauth/oauth-providers.ts's expectations so config
// validation and OAuth provider listing behave the same under test as in
// production. 'radius' is deliberately omitted (see that module's doc
// comment); it must resolve as OAuth-less here too.
const MOCK_OAUTH_PROVIDER_IDS = new Set([
  'anthropic',
  'openai-codex',
  'github-copilot',
  'xai',
  'kimi-coding',
  'openrouter',
]);

const mockModels = {
  complete: mockComplete,
  stream: mockStream,
  getModel: mockGetModel,
  getModels: mockGetModels,
  getProviders: mockGetProviders,
  // Returns a truthy stub for known builtin provider ids, undefined otherwise.
  // Mirrors the real piAiModels.getProvider() (used internally by pi-ai routing).
  getProvider: (id: string) =>
    MOCK_BUILTIN_PROVIDER_IDS.has(id) || MOCK_OAUTH_PROVIDER_IDS.has(id)
      ? {
          id,
          ...(MOCK_OAUTH_PROVIDER_IDS.has(id) ? { auth: { oauth: { name: id } } } : {}),
        }
      : undefined,
};

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

const { DebugManager } = await import('../src/services/observability/debug-manager');

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
