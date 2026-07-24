import { describe, expect, test, vi } from 'vitest';
import {
  GEMINI_MALFORMED_FUNCTION_CALL_MESSAGE,
  detectGeminiMalformedFunctionCall,
  rewriteGeminiMalformedFunctionCallStream,
} from '../gemini-malformed-function-call';

async function rewrite(input: string, onDetected = vi.fn()): Promise<string> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const midpoint = Math.floor(input.length / 2);
      controller.enqueue(encoder.encode(input.slice(0, midpoint)));
      controller.enqueue(encoder.encode(input.slice(midpoint)));
      controller.close();
    },
  }).pipeThrough(rewriteGeminiMalformedFunctionCallStream(onDetected));

  return new Response(stream).text();
}

describe('Gemini MALFORMED_FUNCTION_CALL detection', () => {
  test('uses finishReason as the authoritative trigger and detects a glued text leak', () => {
    const defect = detectGeminiMalformedFunctionCall({
      candidates: [
        {
          finishReason: 'MALFORMED_FUNCTION_CALL',
          content: {
            parts: [
              {
                text: 'Format repository files with biome formatcall:default_api:bash{command:bun run format}',
              },
            ],
          },
        },
      ],
    });

    expect(defect).toEqual({
      code: 'MALFORMED_FUNCTION_CALL',
      message: GEMINI_MALFORMED_FUNCTION_CALL_MESSAGE,
      statusCode: 503,
      textLeakDetected: true,
    });
  });

  test('does not trigger from leaked text without the authoritative finish reason', () => {
    expect(
      detectGeminiMalformedFunctionCall({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'call:default_api:bash{command:bun run format}' }] },
          },
        ],
      })
    ).toBeNull();
  });

  test('preserves ordinary bypass stream bytes exactly', async () => {
    const input = 'data: {"candidates":[{"finishReason":"STOP"}]}\n\ndata: [DONE]\n\n';
    expect(await rewrite(input)).toBe(input);
  });

  test('rewrites only the malformed terminal frame with a retryable message', async () => {
    const onDetected = vi.fn();
    const payload = {
      candidates: [
        {
          content: { parts: [{ text: 'call:default_api:bash{command:bun run format}' }] },
          finishReason: 'MALFORMED_FUNCTION_CALL',
          finishMessage: 'Malformed function call: Failed to parse function call',
        },
      ],
    };
    const output = await rewrite(`data: ${JSON.stringify(payload)}\n\n`, onDetected);
    const rewritten = JSON.parse(output.slice('data: '.length).trim());

    expect(rewritten.candidates[0].finishReason).toBe('MALFORMED_FUNCTION_CALL');
    expect(rewritten.candidates[0].finishMessage).toBe(GEMINI_MALFORMED_FUNCTION_CALL_MESSAGE);
    expect(onDetected).toHaveBeenCalledOnce();
  });
});
