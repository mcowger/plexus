import { vi } from 'vitest';

const testDbUrl = process.env.PLEXUS_TEST_DB_URL;
if (testDbUrl) {
  process.env.DATABASE_URL = process.env.DATABASE_URL || testDbUrl;
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
