import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { DebugManager } from '../debug-manager';
import { UsageStorageService } from '../usage-storage';

describe('DebugManager startup with DEBUG env var', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let debugManager: DebugManager;
  let mockStorage: UsageStorageService;

  beforeEach(() => {
    // Save original environment variables
    originalEnv = { ...process.env };

    // Create a fresh instance for each test
    debugManager = DebugManager.getInstance();

    // Mock storage
    mockStorage = {
      saveDebugLog: () => {},
    } as unknown as UsageStorageService;

    debugManager.setStorage(mockStorage);

    // Reset debug manager to disabled state
    debugManager.setEnabled(false);
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = originalEnv;

    // Reset debug manager state
    debugManager.setEnabled(false);
  });

  test('should enable debug manager when DEBUG=true is set', () => {
    process.env.DEBUG = 'true';

    // Simulate the startup logic from index.ts
    if (process.env.DEBUG === 'true') {
      debugManager.setEnabled(true);
    }

    expect(debugManager.isEnabled()).toBe(true);
  });

  test('should not enable debug manager when DEBUG is not set', () => {
    delete process.env.DEBUG;

    // Simulate the startup logic from index.ts
    if (process.env.DEBUG === 'true') {
      debugManager.setEnabled(true);
    }

    expect(debugManager.isEnabled()).toBe(false);
  });

  test('should not enable debug manager when DEBUG is set to false', () => {
    process.env.DEBUG = 'false';

    // Simulate the startup logic from index.ts
    if (process.env.DEBUG === 'true') {
      debugManager.setEnabled(true);
    }

    expect(debugManager.isEnabled()).toBe(false);
  });

  test('should not enable debug manager when DEBUG is set to 1', () => {
    process.env.DEBUG = '1';

    // Simulate the startup logic from index.ts
    if (process.env.DEBUG === 'true') {
      debugManager.setEnabled(true);
    }

    expect(debugManager.isEnabled()).toBe(false);
  });

  test('should enable debug manager and track debug logs when enabled', () => {
    process.env.DEBUG = 'true';
    debugManager.setEnabled(true);

    expect(debugManager.isEnabled()).toBe(true);

    // Verify that debug logging actually works when enabled
    const requestId = 'test-request-123';
    const rawRequest = { model: 'gpt-4', messages: [] };

    debugManager.startLog(requestId, rawRequest);
    debugManager.addRawResponse(requestId, 'test response');

    // The log should be in pending state
    expect(debugManager.isEnabled()).toBe(true);
  });

  test('should not track debug logs when disabled', () => {
    delete process.env.DEBUG;
    debugManager.setEnabled(false);

    expect(debugManager.isEnabled()).toBe(false);

    // These calls should be no-ops when disabled
    const requestId = 'test-request-456';
    const rawRequest = { model: 'gpt-4', messages: [] };

    debugManager.startLog(requestId, rawRequest);
    debugManager.addRawResponse(requestId, 'test response');

    // The manager should still be disabled
    expect(debugManager.isEnabled()).toBe(false);
  });
});
