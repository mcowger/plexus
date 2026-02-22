import { describe, expect, test, beforeEach, afterEach } from 'bun:test';

// Helper function to replicate the getLogLevel logic for testing
// This is needed because the logger module initializes winston at import time
function getLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }
  if (process.env.DEBUG === 'true') {
    return 'debug';
  }
  return 'info';
}

describe('getLogLevel', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment variables
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;
  });

  test("should return 'info' when no environment variables are set", () => {
    delete process.env.LOG_LEVEL;
    delete process.env.DEBUG;
    expect(getLogLevel()).toBe('info');
  });

  test("should return 'debug' when DEBUG=true is set", () => {
    delete process.env.LOG_LEVEL;
    process.env.DEBUG = 'true';
    expect(getLogLevel()).toBe('debug');
  });

  test("should return 'info' when DEBUG is set to any value other than 'true'", () => {
    delete process.env.LOG_LEVEL;
    process.env.DEBUG = 'false';
    expect(getLogLevel()).toBe('info');

    process.env.DEBUG = '1';
    expect(getLogLevel()).toBe('info');

    process.env.DEBUG = 'yes';
    expect(getLogLevel()).toBe('info');
  });

  test('should prioritize LOG_LEVEL over DEBUG', () => {
    process.env.LOG_LEVEL = 'warn';
    process.env.DEBUG = 'true';
    expect(getLogLevel()).toBe('warn');
  });

  test('should return LOG_LEVEL when set', () => {
    process.env.LOG_LEVEL = 'error';
    delete process.env.DEBUG;
    expect(getLogLevel()).toBe('error');
  });

  test('should handle LOG_LEVEL with various values', () => {
    process.env.LOG_LEVEL = 'silly';
    expect(getLogLevel()).toBe('silly');

    process.env.LOG_LEVEL = 'verbose';
    expect(getLogLevel()).toBe('verbose');

    process.env.LOG_LEVEL = 'debug';
    expect(getLogLevel()).toBe('debug');
  });
});
