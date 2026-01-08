import { expect, test, describe, beforeEach, spyOn } from "bun:test";
import { UsageInspector } from "../usage-logging";
import { UsageStorageService } from "../../usage-storage";
import { UsageRecord } from "../../../types/usage";
import { PassThrough } from "stream";

describe("UsageInspector Cumulative Logic", () => {
    let usageStorage: any;
    let usageRecord: Partial<UsageRecord>;

    beforeEach(() => {
        usageStorage = {
            saveRequest: () => {},
            updatePerformanceMetrics: () => {}
        };
        usageRecord = { requestId: "test-id" };
    });

    test("should not overcount Anthropic tokens when reported in multiple events", async () => {
        const inspector = new UsageInspector(
            "test-id",
            usageStorage as any,
            usageRecord,
            {},
            undefined,
            Date.now()
        ).createInspector("messages");

        // Simulate Anthropic-style events
        // 1. message_start with input tokens
        const event1 = `data: {"type": "message_start", "message": {"id": "msg_1", "usage": {"input_tokens": 100, "output_tokens": 0}}}

`;
        // 2. some content
        const event2 = `data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}

`;
        // 3. message_delta with total tokens (input tokens repeated)
        const event3 = `data: {"type": "message_delta", "usage": {"input_tokens": 100, "output_tokens": 50}}

`;

        const saveSpy = spyOn(usageStorage, "saveRequest");

        inspector.write(event1);
        inspector.write(event2);
        inspector.write(event3);
        inspector.end();

        // Wait for 'end' event on the PassThrough
        await new Promise(resolve => inspector.on('end', resolve));

        expect(usageRecord.tokensInput).toBe(100);
        expect(usageRecord.tokensOutput).toBe(50);
        expect(saveSpy).toHaveBeenCalled();
    });

    test("should correctly handle reasoning tokens in cumulative reports", async () => {
        const inspector = new UsageInspector(
            "test-id",
            usageStorage as any,
            usageRecord,
            {},
            undefined,
            Date.now()
        ).createInspector("messages");

        // 1. message_start
        const event1 = `data: {"type": "message_start", "message": {"id": "msg_1", "usage": {"input_tokens": 1000, "output_tokens": 0, "thinkingTokens": 0}}}

`;
        // 2. message_delta with reasoning tokens
        const event2 = `data: {"type": "message_delta", "usage": {"output_tokens": 500, "thinkingTokens": 400}}

`;

        inspector.write(event1);
        inspector.write(event2);
        inspector.end();

        await new Promise(resolve => inspector.on('end', resolve));

        expect(usageRecord.tokensInput).toBe(1000);
        expect(usageRecord.tokensOutput).toBe(500);
        expect(usageRecord.tokensReasoning).toBe(400);
    });

    test("should skip imputation if reasoning tokens are already reported", async () => {
        const inspector = new UsageInspector(
            "test-id",
            usageStorage as any,
            usageRecord,
            {},
            undefined,
            Date.now()
        ).createInspector("messages");

        // Simulate a stream that has both thinking content AND explicit thinkingTokens
        const event1 = `data: {"type": "content_block_start", "content_block": {"type": "thinking", "thinking": "Let me think..."}}\n\n`;
        const event2 = `data: {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": " more..."}}\n\n`;
        const event3 = `data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}\n\n`;
        // Explicit usage says 100 output tokens, 40 of which were thinking
        // If countTokens("Hello") returns e.g. 1, then imputation would calculate 100 - 1 = 99 thinking tokens.
        // We want to make sure it KEEPS the 40 reported by the provider.
        const event4 = `data: {"type": "message_delta", "usage": {"output_tokens": 100, "thinkingTokens": 40}}\n\n`;

        inspector.write(event1);
        inspector.write(event2);
        inspector.write(event3);
        inspector.write(event4);
        inspector.end();

        await new Promise(resolve => inspector.on('end', resolve));

        expect(usageRecord.tokensOutput).toBe(100);
        expect(usageRecord.tokensReasoning).toBe(40);
    });
});
