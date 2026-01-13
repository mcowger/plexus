import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { DebugLogger } from "./debug-logger";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("DebugLogger", () => {
  const testStoragePath = "./test-data/debug-logs";
  let debugLogger: DebugLogger;

  beforeEach(async () => {
    // Clean up test directory
    try {
      await rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    debugLogger = new DebugLogger({
      enabled: true,
      captureRequests: true,
      captureResponses: true,
      storagePath: testStoragePath,
      retentionDays: 7,
    });
    await debugLogger.initialize();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testStoragePath, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test("should be enabled when configured", () => {
    expect(debugLogger.enabled).toBe(true);
  });

  test("should be disabled when configured", () => {
    const disabledLogger = new DebugLogger({
      enabled: false,
      captureRequests: true,
      captureResponses: true,
      storagePath: testStoragePath,
      retentionDays: 7,
    });
    expect(disabledLogger.enabled).toBe(false);
  });

  test("should capture full request trace", () => {
    const requestId = "test-request-1";
    const clientRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    debugLogger.startTrace(requestId, "chat", clientRequest, {
      "Content-Type": "application/json",
    });

    // Access internal traces map for verification
    const traces = (debugLogger as any).traces;
    expect(traces.has(requestId)).toBe(true);
    expect(traces.get(requestId).clientRequest.body).toEqual(clientRequest);
  });

  test("should capture unified request", () => {
    const requestId = "test-request-2";
    debugLogger.startTrace(requestId, "chat", {});

    const unifiedRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };
    debugLogger.captureUnifiedRequest(requestId, unifiedRequest);

    const traces = (debugLogger as any).traces;
    expect(traces.get(requestId).unifiedRequest).toEqual(unifiedRequest);
  });

  test("should capture provider request", () => {
    const requestId = "test-request-3";
    debugLogger.startTrace(requestId, "chat", {});

    const providerRequest = {
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };
    debugLogger.captureProviderRequest(requestId, "messages", providerRequest);

    const traces = (debugLogger as any).traces;
    expect(traces.get(requestId).providerRequest.body).toEqual(providerRequest);
  });

  test("should capture provider response", () => {
    const requestId = "test-request-4";
    debugLogger.startTrace(requestId, "chat", {});

    const response = {
      id: "msg_123",
      content: [{ type: "text", text: "Hi there!" }],
    };
    debugLogger.captureProviderResponse(requestId, 200, { "content-type": "application/json" }, response);

    const traces = (debugLogger as any).traces;
    expect(traces.get(requestId).providerResponse.body).toEqual(response);
  });

  test("should capture stream snapshots", () => {
    const requestId = "test-request-5";
    debugLogger.startTrace(requestId, "chat", {});

    debugLogger.captureStreamSnapshot(requestId, { delta: { content: "Hello" } });
    debugLogger.captureStreamSnapshot(requestId, { delta: { content: " world" } });

    const traces = (debugLogger as any).traces;
    expect(traces.get(requestId).streamSnapshots).toHaveLength(2);
  });

  test("should store complete trace to disk", async () => {
    const requestId = "test-request-6";
    const clientRequest = {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
    };

    debugLogger.startTrace(requestId, "chat", clientRequest);
    debugLogger.captureUnifiedRequest(requestId, clientRequest);
    debugLogger.captureClientResponse(requestId, 200, { choices: [] });

    await debugLogger.completeTrace(requestId);

    // Check that directory was created and contains the expected files
    // Since the directory name includes a timestamp, we use a glob to find it
    const glob = new Bun.Glob(`*-${requestId}`);
    const dirs = Array.from(glob.scanSync({ cwd: testStoragePath, onlyFiles: false }));
    
    expect(dirs).toHaveLength(1);
    const dirPath = join(testStoragePath, dirs[0]!);
    
    expect(await Bun.file(join(dirPath, "trace.json")).exists()).toBe(true);
    expect(await Bun.file(join(dirPath, "client_request.json")).exists()).toBe(true);
    expect(await Bun.file(join(dirPath, "unified_request.json")).exists()).toBe(true);

    // Verify trace was removed from memory
    const traces = (debugLogger as any).traces;
    expect(traces.has(requestId)).toBe(false);
  });

  test("should not capture when disabled", () => {
    const disabledLogger = new DebugLogger({
      enabled: false,
      captureRequests: true,
      captureResponses: true,
      storagePath: testStoragePath,
      retentionDays: 7,
    });

    const requestId = "test-request-7";
    disabledLogger.startTrace(requestId, "chat", {});

    const traces = (disabledLogger as any).traces;
    expect(traces.has(requestId)).toBe(false);
  });

  test("should not capture requests when captureRequests is false", () => {
    const partialLogger = new DebugLogger({
      enabled: true,
      captureRequests: false,
      captureResponses: true,
      storagePath: testStoragePath,
      retentionDays: 7,
    });

    const requestId = "test-request-8";
    partialLogger.startTrace(requestId, "chat", { model: "gpt-4" });

    const traces = (partialLogger as any).traces;
    expect(traces.has(requestId)).toBe(false);
  });
});
