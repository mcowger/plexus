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