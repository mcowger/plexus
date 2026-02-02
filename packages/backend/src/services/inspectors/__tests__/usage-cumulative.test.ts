import { expect, test, describe, beforeEach, spyOn } from "bun:test";
import { UsageInspector } from "../usage-logging";
import { UsageStorageService } from "../../usage-storage";
import { UsageRecord } from "../../../types/usage";
import { PassThrough } from "stream";

describe.skip("UsageInspector Cumulative Logic (REWRITE NEEDED)", () => {
    let usageStorage: any;
    let usageRecord: Partial<UsageRecord>;

    beforeEach(() => {
        usageStorage = {
            saveRequest: () => {},
            updatePerformanceMetrics: () => {}
        };
        usageRecord = { requestId: "test-id" };
    });

    test.todo("should not overcount Anthropic tokens when reported in multiple events", async () => {
        // This test needs to be rewritten since UsageInspector now extracts usage
        // from reconstructed responses instead of parsing the stream directly.
    });

    test.todo("should correctly handle reasoning tokens in cumulative reports", async () => {
        // This test needs to be rewritten since UsageInspector now extracts usage
        // from reconstructed responses instead of parsing the stream directly.
    });

    test.todo("should skip imputation if reasoning tokens are already reported", async () => {
        // This test needs to be rewritten since UsageInspector now extracts usage
        // from reconstructed responses instead of parsing the stream directly.
    });
});
