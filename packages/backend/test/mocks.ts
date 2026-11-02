/**
 * Shared module mocks for the backend test suite.
 *
 * Importing this module registers the mocks (logger, @earendil-works/pi-ai and
 * its subpaths) process-wide. bun-test.setup.ts imports it as a preload so the
 * registrations exist before any test file loads. Test files that need to
 * assert on or configure a shared mock import the exported handles below.
 */
import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

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

export const mockLogger = {
  level: currentLogLevel,
  error: mock(),
  warn: mock(),
  info: mock(),
  http: mock(),
  verbose: mock(),
  debug: mock(),
  silly: mock(),
};

// Real logger module, captured BEFORE it is mocked. Spread into the mock so every
// named export stays linkable (Bun resolves named imports eagerly),
// and exported so a test that needs real logging can swap it back in.
// Snapshot into a plain object: mock.module() rewrites the live namespace in place.
export const actualLogger = { ...(await import('../src/utils/logger')) };

export const loggerMockModule = {
  ...actualLogger,
  logger: mockLogger,
  logEmitter: { emit: mock(), on: mock(), off: mock() },
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
};

mock.module('../src/utils/logger', () => loggerMockModule);

// ---------------------------------------------------------------------------
// @earendil-works/pi-ai — single authoritative mock for the whole process.
//
// Registering once here (preload runs before any test file) guarantees a
// stable, consistent mock for all consumers.
//
// Rules that every test file must respect:
//   • complete/stream are mock() fns — import them from this module and assert
//     on them directly; re-apply implementations in beforeEach if a test
//     overrides them, because call history is cleared between tests.
//   • getModels returns all known test models so quota-error assertions that
//     validate gpt-5.4/gpt-5.5 are valid for openai-codex always pass.
//   • getModel always includes the `api` field — OAuthTransformer.executeRequest
//     dispatches on model.api and crashes with "No API provider registered"
//     if it is missing.
// ---------------------------------------------------------------------------

export const mockComplete = mock(async () => ({
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'stop',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  provider: 'anthropic',
  model: 'claude-test',
  timestamp: Date.now(),
}));

export const mockStream = mock(async () => ({ ok: true }));

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

// Mirrors pi-ai's builtin provider ids (subset). 'meta' is pi-ai 0.86's native
// Muse subscription provider.
const mockGetProviders = () => ['anthropic', 'openai-codex', 'openai', 'google', 'meta'];

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

const MOCK_BUILTIN_PROVIDER_IDS = new Set(['anthropic', 'openai-codex', 'openai', 'google']);

// Mirrors which real pi-ai builtin providers expose `auth.oauth` — kept in
// sync with services/oauth/oauth-providers.ts's expectations so config
// validation and OAuth provider listing behave the same under test as in
// production. 'radius' is deliberately omitted (see that module's doc
// comment); it must resolve as OAuth-less here too. 'openai' (Sign in with
// ChatGPT) is present because pi-ai ships it; Plexus blocks it itself. 'meta'
// is pi-ai 0.86's native Muse subscription provider.
const MOCK_OAUTH_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'openai-codex',
  'github-copilot',
  'xai',
  'kimi-coding',
  'openrouter',
  'meta',
]);

const mockModels = {
  complete: mockComplete,
  stream: mockStream,
  getModel: mockGetModel,
  getModels: mockGetModels,
  // The real `Models.getProviders()` returns Provider objects; the shared
  // string-id mock is kept for `getBuiltinProviders` (a string list upstream).
  // Mapping to `{ id }` stubs here keeps OAuth provider listing faithful
  // without disturbing the other consumers.
  getProviders: () => mockGetProviders().map((id) => ({ id })),
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

// Partial mock: keeps the real createProvider/isModelType/getModelType so the
// model catalog overlay exercises genuine pi-ai merge/restore/persist semantics.
// The real module MUST be imported here, before registration: importing the
// mocked specifier from inside the factory would recurse into the factory.
const actualPiAi = await import('@earendil-works/pi-ai');

mock.module('@earendil-works/pi-ai', () => {
  return {
    complete: mockModels.complete,
    stream: mockModels.stream,
    calculateCost: mock(() => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 })),
    clampThinkingLevel: (_m: any, l: string) => l,
    getSupportedThinkingLevels: mockGetSupportedThinkingLevels,
    createProvider: actualPiAi.createProvider,
    isModelType: actualPiAi.isModelType,
    getModelType: actualPiAi.getModelType,
  };
});

mock.module('@earendil-works/pi-ai/providers/all', () => ({
  builtinModels: () => mockModels,
  getBuiltinModel: mockGetModel,
  getBuiltinModels: mockGetModels,
  getBuiltinProviders: mockGetProviders,
}));

mock.module('@earendil-works/pi-ai/compat', () => ({
  complete: mockComplete,
  stream: mockStream,
  getModels: mockGetModels,
  getModel: mockGetModel,
  getProviders: mockGetProviders,
}));
