import { Part } from "@google/genai";
import { encode } from "eventsource-encoder";

/**
 * Formats unified chunks back into Gemini's SSE format.
 *
 * Simpler than Anthropic's formatter - Gemini uses a flat structure:
 * - Each chunk contains candidates array with parts
 * - No complex block lifecycle management needed
 */
export function formatGeminiStream(stream: ReadableStream): ReadableStream {
  const encoder = new TextEncoder();

  const transformer = new TransformStream({
    transform(chunk: any, controller) {
      const parts: Part[] = [];

      if (chunk.delta?.content) parts.push({ text: chunk.delta.content });
      if (chunk.delta?.reasoning_content)
        parts.push({
          text: chunk.delta.reasoning_content,
          thought: true,
        } as any);
      if (chunk.delta?.tool_calls) {
        chunk.delta.tool_calls.forEach((tc: any) => {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        });
      }

      if (parts.length > 0 || chunk.finish_reason) {
        const geminiChunk = {
          candidates: [
            {
              content: { role: "model", parts },
              finishReason: chunk.finish_reason?.toUpperCase() || null,
              index: 0,
            },
          ],
          usageMetadata: chunk.usage
            ? {
                promptTokenCount: chunk.usage.input_tokens,
                candidatesTokenCount: chunk.usage.output_tokens,
                totalTokenCount: chunk.usage.total_tokens,
                thoughtsTokenCount: chunk.usage.reasoning_tokens,
              }
            : undefined,
        };
        const sseMessage = encode({ data: JSON.stringify(geminiChunk) });
        controller.enqueue(encoder.encode(sseMessage));
      }
    },
  });

  return stream.pipeThrough(transformer);
}
