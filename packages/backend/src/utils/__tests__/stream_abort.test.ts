import { describe, mock, beforeEach } from "bun:test";

// Mock Logger
mock.module("../logger", () => ({
    logger: {
        debug: mock(),
        error: mock(),
        warn: mock()
    }
}));

// Mock Hono Streaming
mock.module("hono/streaming", () => ({
    stream: (_c: any, cb: any) => ({ handler: cb })
}));

describe("Stream Abort Handling", () => {
    let mockStorage: any;
    let mockTransformer: any;
    let mockContext: any;

    beforeEach(() => {
        mockStorage = {
            saveRequest: mock(),
            saveError: mock(),
            updatePerformanceMetrics: mock()
        };

        mockTransformer = {
            name: "test-transformer",
            formatStream: mock((s: any) => s),
        };

        mockContext = {
            json: mock(),
            header: mock(),
        };
    });

});
