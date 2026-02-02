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

const mockLogger = {
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
        logEmitter: { emit: mock(), on: mock() },
        StreamTransport: class {}
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
initializeDatabase();
await runMigrations();