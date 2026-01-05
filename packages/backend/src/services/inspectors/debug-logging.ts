import { PassThrough } from "stream";
import { logger } from "../../utils/logger";
import { BaseInspector } from "./base";
import { DebugManager } from "../debug-manager";

export class DebugLoggingInspector extends BaseInspector {
  private debugManager = DebugManager.getInstance();

  createInspector(providerApiType: string): PassThrough {
    const inspector = new PassThrough();
    let rawBody = "";

    inspector.on("data", (chunk: Buffer) => {
      rawBody += chunk.toString();
    });

    inspector.on("end", () => {
      try {
        if (providerApiType === "chat") {
          const rescontructred = this.reconstructChatCompletions(rawBody);
          logger.silly(`[Inspector] Request ${this.requestId} reconstructed: ${JSON.stringify(rescontructred, null, 2)}`);
          this.saveTransformedResponse(rescontructred);
          this.saveRawResponse(rawBody);
        }
      } catch (err) {
        logger.error(`[Inspector] Reconstruction failed: ${err}`);
        this.saveRawResponse(rawBody);
      }
    });

    return inspector;
  }

  private saveRawResponse(fullBody: string): void {
    this.debugManager.addTransformedResponseSnapshot(this.requestId, fullBody);
  }

  private saveTransformedResponse(snapshot: any): void {
    this.debugManager.addTransformedResponse(this.requestId, snapshot);
  }

  private reconstructChatCompletions(fullBody: string): any {
    const lines = fullBody.split(/\r?\n/);
    let snapshot: any = null;

    for (const line of lines) {
      const jsonStr = line.replace(/^data:\s*/, "").trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        snapshot = this.updateChatCompletionsSnapshot(snapshot, chunk);
      } catch (e) {
        // Skip malformed/non-JSON lines
      }
    }
    return snapshot;
  }
  /**
   * Applies a chunk to the existing snapshot using index-based merging.
   */
  private updateChatCompletionsSnapshot(acc: any, chunk: any): any {
    // 1. Initial State
    if (!acc) return { ...chunk };

    // 2. Simple Key Overwrites (id, model, object, system_fingerprint, usage)
    const result = { ...acc, ...chunk };

    // 3. Choice Aggregation (The complex part)
    if (chunk.choices) {
      result.choices = acc.choices ? [...acc.choices] : [];

      for (const chunkChoice of chunk.choices) {
        const idx = chunkChoice.index ?? 0;
        
        // Ensure the choice exists in our accumulator
        if (!result.choices[idx]) {
          result.choices[idx] = { index: idx, delta: {} };
        }

        const accChoice = result.choices[idx];
        const delta = chunkChoice.delta;

        if (delta) {
          // A. Role/Finish Reason (Overwrite)
          if (delta.role) accChoice.delta.role = delta.role;
          if (chunkChoice.finish_reason) accChoice.finish_reason = chunkChoice.finish_reason;

          // B. Text Buffers (Concatenate strings, IGNORE nulls)
          // Includes content, reasoning_content, refusal, etc.
          ["content", "reasoning_content", "refusal"].forEach(key => {
            if (typeof delta[key] === "string") {
              accChoice.delta[key] = (accChoice.delta[key] || "") + delta[key];
            }
          });

          // C. Tool Calls (Merged by tool index)
          if (delta.tool_calls) {
            if (!accChoice.delta.tool_calls) accChoice.delta.tool_calls = [];
            
            for (const newTool of delta.tool_calls) {
              const tIdx = newTool.index;
              if (!accChoice.delta.tool_calls[tIdx]) {
                accChoice.delta.tool_calls[tIdx] = { function: { name: "", arguments: "" } };
              }

              const accTool = accChoice.delta.tool_calls[tIdx];
              if (newTool.id) accTool.id = newTool.id;
              if (newTool.type) accTool.type = newTool.type;
              if (newTool.function?.name) accTool.function.name = newTool.function.name;
              
              // Tool Arguments are streamed as string fragments
              if (typeof newTool.function?.arguments === "string") {
                accTool.function.arguments += newTool.function.arguments;
              }
            }
          }
        }
      }
    }

    return result;
  }
}