import { GeminiTransformer } from "./gemini";
import { UnifiedChatRequest } from "../types/unified";
import crypto from "crypto";
import { logger } from "../utils/logger";

/**
 * AntigravityTransformer
 *
 * Extends GeminiTransformer to use Antigravity-specific endpoints and request format.
 * Antigravity uses the cloudcode-pa.googleapis.com API with the v1internal namespace.
 *
 * Key Differences from Standard Gemini:
 * - Wraps the Gemini request body in an Antigravity envelope
 * - Envelope includes: model, project, requestId, and request object
 * - Standard Gemini contents/generationConfig are nested under "request" key
 */
export class AntigravityTransformer extends GeminiTransformer {
  name = "antigravity";

  /**
   * getEndpoint
   * Overrides the Gemini endpoint to use Antigravity's v1internal API.
   * Base URL: https://cloudcode-pa.googleapis.com
   * Endpoint pattern: /v1internal:generateContent or /v1internal:streamGenerateContent?alt=sse
   */
  getEndpoint(request: UnifiedChatRequest): string {
    const action = request.stream
      ? "streamGenerateContent"
      : "generateContent";

    // Antigravity uses v1internal namespace without model in the path
    // For streaming, add ?alt=sse to request Server-Sent Events format
    const endpoint = `/v1internal:${action}`;
    return request.stream ? `${endpoint}?alt=sse` : endpoint;
  }

  /**
   * transformRequest
   * Wraps the standard Gemini request format in an Antigravity envelope.
   *
   * Antigravity expects:
   * {
   *   "model": "gemini-3-flash-preview",
   *   "project": "project-id",
   *   "requestId": "agent-uuid",
   *   "request": {
   *     "contents": [...],
   *     "generationConfig": {...},
   *     "sessionId": "..."
   *   }
   * }
   */
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Get standard Gemini format from parent transformer
    const geminiRequest = await super.transformRequest(request);

    // Generate session ID based on contents for stability
    const sessionId = this.generateSessionId(geminiRequest.contents);

    // Get project ID from OAuth metadata if available, otherwise generate random
    const projectId = request.metadata?.oauth_project_id || this.generateProjectId();

    // Wrap in Antigravity envelope
    const antigravityRequest = {
      model: request.model,
      project: projectId,
      requestId: `agent-${crypto.randomUUID()}`,
      userAgent: "antigravity",
      request: {
        ...geminiRequest,
        sessionId,
        toolConfig: geminiRequest.tools ? {
          functionCallingConfig: {
            mode: "VALIDATED"
          }
        } : undefined
      }
    };

    return antigravityRequest;
  }

  /**
   * Generate a stable session ID based on request contents
   */
  private generateSessionId(contents: any): string {
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(contents));
    return hash.digest("hex").substring(0, 32);
  }

  /**
   * Generate a project ID
   * Note: In production, this should come from OAuth metadata or configuration
   */
  private generateProjectId(): string {
    // For now, generate a random project ID
    // This will be replaced with actual project ID from OAuth credentials
    return `project-${crypto.randomUUID()}`;
  }

  /**
   * transformResponse
   * Unwraps the Antigravity response envelope before delegating to parent GeminiTransformer.
   *
   * Antigravity wraps the standard Gemini response in a { response: {...} } object.
   * This method extracts the inner response and passes it to the parent transformer.
   */
  async transformResponse(response: any): Promise<any> {
    // Antigravity wraps the response in a "response" object
    const innerResponse = response.response || response;

    // Delegate to parent GeminiTransformer to handle the standard Gemini format
    return super.transformResponse(innerResponse);
  }

  /**
   * transformStream (Provider Stream -> Unified Stream)
   * Overrides GeminiTransformer to unwrap Antigravity's response envelope in stream chunks.
   *
   * Antigravity wraps each SSE chunk's data in a { response: {...} } object,
   * so we need to unwrap it before passing to the parent's SSE parser.
   */
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let buffer = "";

    // First, unwrap the Antigravity envelope from each SSE chunk
    const unwrapTransformer = new TransformStream({
      transform(chunk, controller) {
        const text = typeof chunk === "string"
          ? chunk
          : decoder.decode(chunk, { stream: true });

        // Accumulate into buffer
        buffer += text;

        // Split on both \n and \r\n to handle different line endings
        const lines = buffer.split(/\r?\n/);
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          // Trim \r if present (from \r\n split)
          const cleanLine = line.replace(/\r$/, '');

          if (cleanLine.startsWith('data: ')) {
            try {
              const jsonStr = cleanLine.substring(6); // Remove "data: " prefix
              if (jsonStr.trim() === '[DONE]') {
                controller.enqueue('data: [DONE]\n\n');
                continue;
              }

              const parsed = JSON.parse(jsonStr);
              // Unwrap the Antigravity envelope
              const innerData = parsed.response || parsed;

              // Re-encode as SSE format with double newline to signal end of event
              const unwrappedLine = `data: ${JSON.stringify(innerData)}\n\n`;
              controller.enqueue(unwrappedLine);
            } catch (e) {
              // If parsing fails, log and skip
              logger.error('[AntigravityTransformer] Failed to parse SSE data line:', e);
            }
          }
          // Don't emit empty lines - they're just event separators from the source
        }
      },
      flush(controller) {
        // Process any remaining buffer content
        if (buffer.trim()) {
          if (buffer.startsWith('data: ')) {
            try {
              const jsonStr = buffer.substring(6);
              const parsed = JSON.parse(jsonStr);
              const innerData = parsed.response || parsed;
              const unwrappedLine = `data: ${JSON.stringify(innerData)}\n\n`;
              controller.enqueue(unwrappedLine);
            } catch (e) {
              logger.error('[AntigravityTransformer] Failed to parse final SSE data:', e);
            }
          }
        }
      }
    });

    // First unwrap, then pass to parent's Gemini SSE parser
    const unwrappedStream = stream.pipeThrough(unwrapTransformer);
    return super.transformStream(unwrappedStream);
  }
}
