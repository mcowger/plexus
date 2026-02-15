import { describe, expect, test } from "bun:test";
import { ResponsesTransformer } from "../responses";

describe("ResponsesTransformer usage formatting", () => {
  test("formatResponse emits input_tokens as total input including cache", async () => {
    const transformer = new ResponsesTransformer();

    const formatted = await transformer.formatResponse({
      id: "resp_1",
      model: "gpt-4o",
      created: 1234567890,
      content: "done",
      usage: {
        input_tokens: 2571,
        output_tokens: 416,
        total_tokens: 17963,
        reasoning_tokens: 0,
        cached_tokens: 14976,
        cache_creation_tokens: 0,
      },
    });

    expect(formatted.usage.input_tokens).toBe(17547);
    expect(formatted.usage.input_tokens_details.cached_tokens).toBe(14976);
    expect(formatted.usage.output_tokens).toBe(416);
    expect(formatted.usage.total_tokens).toBe(17963);
  });

  test("formatStream response.completed emits total input_tokens including cache", async () => {
    const transformer = new ResponsesTransformer();

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          id: "chatcmpl_1",
          model: "gpt-4o",
          created: 1234567890,
          delta: { role: "assistant", content: "hello" },
          usage: {
            input_tokens: 2571,
            output_tokens: 416,
            total_tokens: 17963,
            reasoning_tokens: 0,
            cached_tokens: 14976,
            cache_creation_tokens: 0,
          },
        });

        controller.enqueue({
          id: "chatcmpl_1",
          model: "gpt-4o",
          created: 1234567890,
          delta: {},
          finish_reason: "tool_calls",
          usage: {
            input_tokens: 2571,
            output_tokens: 416,
            total_tokens: 17963,
            reasoning_tokens: 0,
            cached_tokens: 14976,
            cache_creation_tokens: 0,
          },
        });

        controller.close();
      },
    });

    const formattedStream = transformer.formatStream(stream);
    const reader = formattedStream.getReader();
    const decoder = new TextDecoder();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value);
    }

    const completedEvent = output
      .split("\n\n")
      .find((line) => line.includes('"type":"response.completed"'));

    expect(completedEvent).toBeDefined();
    const payloadLine = (completedEvent as string)
      .split("\n")
      .find((line) => line.startsWith("data: "));
    expect(payloadLine).toBeDefined();
    const payload = JSON.parse((payloadLine as string).replace(/^data:\s*/, ""));

    expect(payload.response.usage.input_tokens).toBe(17547);
    expect(payload.response.usage.input_tokens_details.cached_tokens).toBe(14976);
    expect(payload.response.usage.output_tokens).toBe(416);
    expect(payload.response.usage.total_tokens).toBe(17963);
  });
});
