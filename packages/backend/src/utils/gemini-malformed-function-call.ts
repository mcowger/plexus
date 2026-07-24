export const GEMINI_MALFORMED_FUNCTION_CALL_CODE = 'MALFORMED_FUNCTION_CALL';
export const GEMINI_MALFORMED_FUNCTION_CALL_MESSAGE =
  'Upstream Gemini returned MALFORMED_FUNCTION_CALL (model emitted a text tool-call leak). This is a transient model defect — please retry your request. [503]';

const GEMINI_TOOL_CALL_LEAK_PATTERN = /(?:print\()?call:\s*default_api[.:]|default_api\.\w+\s*\(/;

export interface GeminiMalformedFunctionCall {
  code: typeof GEMINI_MALFORMED_FUNCTION_CALL_CODE;
  message: string;
  statusCode: 503;
  textLeakDetected: boolean;
}

export function detectGeminiMalformedFunctionCall(
  payload: unknown
): GeminiMalformedFunctionCall | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidate = (payload as any).candidates?.[0];
  if (candidate?.finishReason !== GEMINI_MALFORMED_FUNCTION_CALL_CODE) return null;

  const textLeakDetected = (candidate.content?.parts ?? []).some(
    (part: any) => typeof part?.text === 'string' && GEMINI_TOOL_CALL_LEAK_PATTERN.test(part.text)
  );

  return {
    code: GEMINI_MALFORMED_FUNCTION_CALL_CODE,
    message: GEMINI_MALFORMED_FUNCTION_CALL_MESSAGE,
    statusCode: 503,
    textLeakDetected,
  };
}

export function rewriteGeminiMalformedFunctionCallStream(
  onDetected?: (defect: GeminiMalformedFunctionCall) => void
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const rewriteLine = (line: string): string => {
    const match = /^(data:\s*)(.*)$/.exec(line);
    if (!match || match[2] === '[DONE]') return line;

    try {
      const payload = JSON.parse(match[2]!);
      const defect = detectGeminiMalformedFunctionCall(payload);
      if (!defect) return line;

      payload.candidates[0].finishMessage = defect.message;
      onDetected?.(defect);
      return `${match[1]}${JSON.stringify(payload)}`;
    } catch {
      return line;
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${rewriteLine(line)}\n`));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(rewriteLine(buffer)));
    },
  });
}
