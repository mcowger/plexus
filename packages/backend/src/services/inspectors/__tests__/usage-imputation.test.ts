import { test, expect, describe, beforeEach } from "bun:test";
import { UsageInspector } from "../usage-logging";
import { UsageStorageService } from "../../usage-storage";
import { UsageRecord } from "../../../types/usage";
import { TransformerFactory } from "../../transformer-factory";
import { AnthropicTransformer } from "../../../transformers/anthropic";

describe("UsageInspector Anthropic Imputation", () => {
  let usageStorage: any;
  let usageRecord: Partial<UsageRecord>;

  beforeEach(() => {
    usageStorage = {
      saveRequest: () => {},
      updatePerformanceMetrics: () => {},
    } as unknown as UsageStorageService;

    usageRecord = {
      requestId: "test-req-id",
    };

    TransformerFactory.getTransformer = (type: string) => {
        if (type === 'messages') return new AnthropicTransformer();
        throw new Error(`Unknown type ${type}`);
    };
  });

  test("should impute thinking tokens when thinking is present but not in usage", async () => {
    const inspectorInstance = new UsageInspector(
      "test-req-id",
      usageStorage,
      usageRecord,
      {},
      0,
      Date.now()
    );
    
    const stream = inspectorInstance.createInspector("messages");

    // Simulate stream with thinking block and text block
    // Thinking block (e.g. 5 tokens)
    stream.write(`event: content_block_start\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}\n\n`);
    stream.write(`event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "thinking..."}}\n\n`); // length 11
    
    // Text block (e.g. "hello world" -> 2 tokens)
    stream.write(`event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hello world"}}\n\n`);
    
    // Usage report (Total output = 100, implying 98 thinking?)
    // Note: countTokens("hello world") is roughly 2.
    // So imputed = 100 - 2 = 98.
    stream.write(`event: message_delta\ndata: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 100}}\n\n`);
    
    stream.end();

    await new Promise((resolve) => stream.on("finish", resolve));

    expect(usageRecord.tokensOutput).toBeLessThan(100); // Should be text tokens only (approx 2-3)
    expect(usageRecord.tokensReasoning).toBeGreaterThan(90); // Should be imputed (approx 97-98)
  });
});
