import { mock } from "bun:test";

/**
 * Global Robust Mock for Logger
 * 
 * Bun test runner reuses worker processes across test files. 
 * Using mock.module is a process-global operation that cannot be easily 
 * undone with mock.restore(). 
 * 
 * By preloading this complete mock, we ensure:
 * 1. No tests fail due to missing logger methods (e.g. "logger.info is not a function").
 * 2. Console output is suppressed during tests.
 * 3. Tests can still spy on these methods if they need to verify logging behavior.
 */

const SUPPORTED_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'] as const;

type MockLogLevel = typeof SUPPORTED_LOG_LEVELS[number];

const normalizeLogLevel = (value: unknown): MockLogLevel | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return (SUPPORTED_LOG_LEVELS as readonly string[]).includes(normalized)
        ? normalized as MockLogLevel
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
    error: mock(),
    warn: mock(),
    info: mock(),
    http: mock(),
    verbose: mock(),
    debug: mock(),
    silly: mock(),
};

// Mock the logger module for all common import paths used in the project
const loggerPaths = [
    "src/utils/logger",
    "packages/backend/src/utils/logger",
    "../utils/logger",
    "../../utils/logger"
];

for (const path of loggerPaths) {
    mock.module(path, () => ({
        logger: mockLogger,
        logEmitter: { emit: mock(), on: mock(), off: mock() },
        StreamTransport: class {},
        SUPPORTED_LOG_LEVELS,
        getStartupLogLevel,
        getCurrentLogLevel: () => currentLogLevel,
        setCurrentLogLevel: (level: string) => {
            const normalized = normalizeLogLevel(level);
            if (!normalized) {
                throw new Error(`Invalid log level '${level}'. Supported levels: ${SUPPORTED_LOG_LEVELS.join(', ')}`);
            }
            currentLogLevel = normalized;
            mockLogger.level = normalized;
            return normalized;
        },
        resetCurrentLogLevel: () => {
            currentLogLevel = getStartupLogLevel();
            mockLogger.level = currentLogLevel;
            return currentLogLevel;
        }
    }));
}

// Initialize database for tests
import { loadConfig } from "../src/config";
import { initializeDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

// Load minimal test config with database section before initializing database
const testDbUrl = process.env.PLEXUS_TEST_DB_URL || "sqlite://:memory:";
const testConfig = `
database:
  connection_string: "${testDbUrl}"
adminKey: test-key
providers: {}
models: {}
keys: {}
`;

// Set the test config
const { setConfigForTesting, validateConfig } = await import("../src/config");
setConfigForTesting(validateConfig(testConfig));

// Initialize database with the test config
initializeDatabase(testDbUrl);
await runMigrations();
