import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { UsageStorageService } from "../usage-storage";
import { UsageRecord } from "../../types/usage";

// Mock Logger to suppress output
mock.module("../../utils/logger", () => ({
    logger: {
        info: mock(),
        error: mock(),
        warn: mock(),
        debug: mock(),
        silly: mock(),
    }
}));

describe("UsageStorageService", () => {
    let service: UsageStorageService;

    beforeEach(() => {
        // Use in-memory database for testing
        service = new UsageStorageService(":memory:");
    });

    afterEach(() => {
        service.getDb().close();
    });

    test("should initialize database with correct schema", () => {
        const db = service.getDb();
        const query = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='request_usage';");
        const result = query.get();
        expect(result).not.toBeNull();
        expect(result).toEqual({ name: "request_usage" });
    });

    test("should save a usage record", () => {
        const record: UsageRecord = {
            requestId: "test-request-id",
            date: new Date().toISOString(),
            sourceIp: "127.0.0.1",
            apiKey: "sk-test",
            incomingApiType: "openai",
            provider: "openai",
            incomingModelAlias: "gpt-4",
            selectedModelName: "gpt-4-0613",
            outgoingApiType: "openai",
            tokensInput: 10,
            tokensOutput: 20,
            tokensReasoning: 5,
            tokensCached: 2,
            startTime: Date.now(),
            durationMs: 150,
            isStreamed: false,
            responseStatus: "success"
        };

        service.saveRequest(record);

        const db = service.getDb();
        const query = db.query("SELECT * FROM request_usage WHERE request_id = $requestId");
        const saved = query.get({ $requestId: "test-request-id" }) as any;

        expect(saved).not.toBeNull();
        expect(saved.request_id).toBe(record.requestId);
        expect(saved.source_ip).toBe(record.sourceIp);
        expect(saved.tokens_input).toBe(record.tokensInput);
        expect(saved.tokens_output).toBe(record.tokensOutput);
        expect(saved.is_streamed).toBe(0);
        expect(saved.response_status).toBe("success");
    });

    test("should handle null values correctly", () => {
        const record: UsageRecord = {
            requestId: "test-nulls",
            date: new Date().toISOString(),
            sourceIp: null,
            apiKey: null,
            incomingApiType: "anthropic",
            provider: null,
            incomingModelAlias: null,
            selectedModelName: null,
            outgoingApiType: null,
            tokensInput: null,
            tokensOutput: null,
            tokensReasoning: null,
            tokensCached: null,
            startTime: Date.now(),
            durationMs: 100,
            isStreamed: true,
            responseStatus: "error"
        };

        service.saveRequest(record);

        const db = service.getDb();
        const query = db.query("SELECT * FROM request_usage WHERE request_id = $requestId");
        const saved = query.get({ $requestId: "test-nulls" }) as any;

        expect(saved).not.toBeNull();
        expect(saved.source_ip).toBeNull();
        expect(saved.tokens_input).toBeNull();
        expect(saved.is_streamed).toBe(1);
    });

    test("should retrieve usage with pagination", () => {
        const baseRecord: UsageRecord = {
            requestId: "",
            date: new Date().toISOString(),
            sourceIp: "127.0.0.1",
            apiKey: "sk-test",
            incomingApiType: "openai",
            provider: "openai",
            incomingModelAlias: "gpt-4",
            selectedModelName: "gpt-4-0613",
            outgoingApiType: "openai",
            tokensInput: 10,
            tokensOutput: 20,
            tokensReasoning: 0,
            tokensCached: 0,
            startTime: Date.now(),
            durationMs: 150,
            isStreamed: false,
            responseStatus: "success"
        };

        for (let i = 0; i < 5; i++) {
            service.saveRequest({ ...baseRecord, requestId: `req-${i}`, date: new Date(Date.now() - i * 1000).toISOString() });
        }

        const result = service.getUsage({}, { limit: 2, offset: 0 });
        expect(result.total).toBe(5);
        expect(result.data.length).toBe(2);
        // Ordered by date DESC, so req-0 (newest) first
        expect(result.data[0].requestId).toBe("req-0");
        expect(result.data[1].requestId).toBe("req-1");

        const result2 = service.getUsage({}, { limit: 2, offset: 2 });
        expect(result2.data.length).toBe(2);
        expect(result2.data[0].requestId).toBe("req-2");
    });

    test("should filter usage with partial text match (LIKE)", () => {
        const record1: UsageRecord = {
            requestId: "req-1",
            date: new Date().toISOString(),
            sourceIp: "127.0.0.1",
            apiKey: "key",
            incomingApiType: "openai",
            provider: "openai-production",
            incomingModelAlias: "gpt-4-turbo",
            selectedModelName: "gpt-4-0613",
            outgoingApiType: "openai",
            tokensInput: 10,
            tokensOutput: 20,
            tokensReasoning: 0,
            tokensCached: 0,
            startTime: Date.now(),
            durationMs: 100,
            isStreamed: false,
            responseStatus: "success"
        };
        const record2: UsageRecord = {
            ...record1,
            requestId: "req-2",
            provider: "anthropic-claude",
            incomingModelAlias: "claude-3-opus",
            selectedModelName: "claude-3-opus-20240229"
        };

        service.saveRequest(record1);
        service.saveRequest(record2);

        // Filter by partial provider
        const resProvider = service.getUsage({ provider: "openai" }, { limit: 10, offset: 0 });
        expect(resProvider.total).toBe(1);
        expect(resProvider.data[0].requestId).toBe("req-1");

        // Filter by partial model alias
        const resModel = service.getUsage({ incomingModelAlias: "claude" }, { limit: 10, offset: 0 });
        expect(resModel.total).toBe(1);
        expect(resModel.data[0].requestId).toBe("req-2");
        
        // Filter by partial selected model
        const resSelected = service.getUsage({ selectedModelName: "0613" }, { limit: 10, offset: 0 });
        expect(resSelected.total).toBe(1);
        expect(resSelected.data[0].requestId).toBe("req-1");
    });

    test("should delete a debug log", () => {
        const logRecord = {
            requestId: "debug-req-1",
            createdAt: Date.now(),
            rawRequest: "{}",
            transformedRequest: "{}",
            rawResponse: "{}",
            transformedResponse: "{}"
        };

        service.saveDebugLog(logRecord);

        // Verify it exists
        const savedLog = service.getDebugLog("debug-req-1");
        expect(savedLog).not.toBeNull();

        // Delete it
        const deleted = service.deleteDebugLog("debug-req-1");
        expect(deleted).toBe(true);

        // Verify it's gone
        const deletedLog = service.getDebugLog("debug-req-1");
        expect(deletedLog).toBeNull();
    });

    test("should return false when deleting non-existent debug log", () => {
        const deleted = service.deleteDebugLog("non-existent-id");
        expect(deleted).toBe(false);
    });

    test("should delete all debug logs", () => {
        service.saveDebugLog({
            requestId: "req-1",
            createdAt: Date.now(),
            rawRequest: "{}", transformedRequest: "{}", rawResponse: "{}", transformedResponse: "{}"
        });
        service.saveDebugLog({
            requestId: "req-2",
            createdAt: Date.now(),
            rawRequest: "{}", transformedRequest: "{}", rawResponse: "{}", transformedResponse: "{}"
        });

        expect(service.getDebugLogs().length).toBe(2);

        const success = service.deleteAllDebugLogs();
        expect(success).toBe(true);

        expect(service.getDebugLogs().length).toBe(0);
    });
});
