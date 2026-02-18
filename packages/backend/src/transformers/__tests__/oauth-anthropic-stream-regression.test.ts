import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AnthropicTransformer } from "../anthropic";
import { piAiEventToChunk } from "../oauth/type-mappers";

interface ToolCallExpectation {
  id: string;
  arguments: string;
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseTrace(fileName: string): {
  events: any[];
  expectedToolCalls: ToolCallExpectation[];
} {
  const tracePath = new URL(`../../../../../tshooting/${fileName}`, import.meta.url);
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));

  const events = String(trace.rawResponse)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const expectedToolCalls: ToolCallExpectation[] = (trace.rawResponseSnapshot?.tool_calls || [])
    .filter((toolCall: any) => toolCall && toolCall.type === "function")
    .map((toolCall: any) => ({
      id: toolCall.id,
      arguments: toolCall.function.arguments,
    }));

  return { events, expectedToolCalls };
}

function toReadableStream(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  return output;
}

function parseSse(output: string): Array<{ event: string; data: any }> {
  const records: Array<{ event: string; data: any }> = [];
  let currentEvent = "";

  for (const line of output.split("\n")) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice("event: ".length);
      continue;
    }

    if (line.startsWith("data: ")) {
      records.push({
        event: currentEvent,
        data: JSON.parse(line.slice("data: ".length)),
      });
      currentEvent = "";
    }
  }

  return records;
}

describe("OAuth -> Anthropic stream regression", () => {
  test("piAiEventToChunk ignores toolcall_end chunks", () => {
    const toolcallEndEvent = {
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: {
        id: "toolu_123",
        name: "bash",
        arguments: { command: "ls" },
      },
    };

    const chunk = piAiEventToChunk(toolcallEndEvent as any, "claude-sonnet-4-6", "anthropic");
    expect(chunk).toBeNull();
  });

  for (const fileName of ["turn1.json", "turn2.json"]) {
    test(`maintains single tool block per tool call for ${fileName}`, async () => {
      const { events, expectedToolCalls } = parseTrace(fileName);

      const unifiedChunks = events
        .map((event) =>
          piAiEventToChunk(
            event,
            event.partial?.model || "unknown",
            event.partial?.provider || event.message?.provider || event.error?.provider
          )
        )
        .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null);

      const anthropic = new AnthropicTransformer();
      const formatted = anthropic.formatStream(toReadableStream(unifiedChunks));
      const output = await streamToString(formatted as ReadableStream<Uint8Array>);
      const records = parseSse(output);

      const toolStarts = records.filter(
        ({ event, data }) =>
          event === "content_block_start" && data.content_block?.type === "tool_use"
      );

      expect(toolStarts.length).toBe(expectedToolCalls.length);

      const blockIndexToToolId = new Map<number, string>();
      const argumentsByToolId = new Map<string, string>();

      for (const { event, data } of records) {
        if (event === "content_block_start" && data.content_block?.type === "tool_use") {
          blockIndexToToolId.set(data.index, data.content_block.id);
          argumentsByToolId.set(data.content_block.id, "");
        }

        if (
          event === "content_block_delta" &&
          data.delta?.type === "input_json_delta" &&
          typeof data.index === "number"
        ) {
          const toolId = blockIndexToToolId.get(data.index);
          if (!toolId) continue;
          const previous = argumentsByToolId.get(toolId) || "";
          argumentsByToolId.set(toolId, previous + (data.delta.partial_json || ""));
        }
      }

      for (const expectedToolCall of expectedToolCalls) {
        const received = argumentsByToolId.get(expectedToolCall.id) || "";
        expect(parseJsonOrString(received)).toEqual(
          parseJsonOrString(expectedToolCall.arguments)
        );
      }
    });
  }
});
