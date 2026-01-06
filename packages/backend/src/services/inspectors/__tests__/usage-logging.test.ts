import { test, expect, spyOn, describe, beforeEach } from "bun:test";
import { UsageInspector } from "../usage-logging";
import { UsageStorageService } from "../../usage-storage";
import { UsageRecord } from "../../../types/usage";
import { TransformerFactory } from "../../transformer-factory";
import { OpenAITransformer } from "../../../transformers/openai";
import { logger } from "../../../utils/logger";

describe("UsageInspector Reproduction", () => {
  let usageStorage: any;
  let inspector: any;
  let usageRecord: Partial<UsageRecord>;

  beforeEach(() => {
    // Mock UsageStorageService
    usageStorage = {
      saveRequest: () => {},
      updatePerformanceMetrics: () => {},
    } as unknown as UsageStorageService;

    // Reset UsageRecord
    usageRecord = {
      requestId: "test-req-id",
    };

    // Ensure TransformerFactory returns OpenAITransformer for 'chat'
    TransformerFactory.getTransformer = (type: string) => {
        if (type === 'chat') return new OpenAITransformer();
        throw new Error(`Unknown type ${type}`);
    };
  });

  test("should parse usage from the user provided example line", async () => {
    const userLine = `data: {"id":"gen-1767661749-Ot82GxmBb3KHB9UFhSnd","provider":"Parasail","model":"z-ai/glm-4.7","object":"chat.completion.chunk","created":1767661749,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null,"native_finish_reason":null,"logprobs":null}],"usage":{"prompt_tokens":8,"completion_tokens":174,"total_tokens":182,"cost":0.00036531,"is_byok":false,"prompt_tokens_details":{"cached_tokens":2,"audio_tokens":0,"video_tokens":0},"cost_details":{"upstream_inference_cost":null,"upstream_inference_prompt_cost":0.0000036,"upstream_inference_completions_cost":0.0003654},"completion_tokens_details":{"reasoning_tokens":173,"image_tokens":0}}}`;

    // Create the inspector for 'chat' type (OpenAI)
    const usageInspectorInstance = new UsageInspector(
      "test-req-id",
      usageStorage,
      usageRecord,
      {},
      0,
      Date.now()
    );
    
    const stream = usageInspectorInstance.createInspector("chat");

    // Feed the line in chunks to test buffering
    const chunk1 = userLine.substring(0, 50);
    const chunk2 = userLine.substring(50);
    
    stream.write(chunk1);
    stream.write(chunk2 + "\n\n"); // Proper SSE termination
    stream.end();

    // Wait for stream to finish
    await new Promise((resolve) => stream.on("finish", resolve));

    // Check usageRecord
    expect(usageRecord.tokensInput).toBe(8);
    expect(usageRecord.tokensOutput).toBe(174);
    expect(usageRecord.tokensCached).toBe(2);
    expect(usageRecord.tokensReasoning).toBe(173);
  });
});
