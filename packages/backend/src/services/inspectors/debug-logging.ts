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
        let reconstructed: any = null;
        switch (providerApiType) {
          case "chat":
            reconstructed = this.reconstructChatCompletions(rawBody);
            break;
          case "messages":
            reconstructed = this.reconstructMessages(rawBody);
            break;
          case "gemini":
            reconstructed = this.reconstructGemini(rawBody);
            break;
          default:
            logger.warn(`[Inspector] Unknown providerApiType: ${providerApiType}`);
        }
        logger.silly(`[Inspector] Request ${this.requestId} reconstructed: ${JSON.stringify(reconstructed, null, 2)}`);
        this.saveReconstructedResponse(reconstructed);
        this.saveRawResponse(rawBody);
      } catch (err) {
        logger.error(`[Inspector] Reconstruction failed: ${err}`);
        this.saveRawResponse(rawBody);
      }
    });

    return inspector;
  }

  private saveRawResponse(fullBody: string): void {
    this.debugManager.addRawResponse(this.requestId, fullBody);
  }

  private saveReconstructedResponse(snapshot: any): void {
    this.debugManager.addReconstructedRawResponse(this.requestId, snapshot);
  }

  private reconstructChatCompletions(fullBody: string): any {
    const lines = fullBody.split(/\r?\n/);
    let snapshot: any = null;

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
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

  private reconstructMessages(fullBody: string): any {
    const lines = fullBody.split(/\r?\n/);
    let snapshot: any = null;

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.replace(/^data:\s*/, "").trim();
      if (!jsonStr) continue;

      try {
        const chunk = JSON.parse(jsonStr);
        snapshot = this.updateMessagesSnapshot(snapshot, chunk);
      } catch (e) {
        // Skip malformed/non-JSON lines
      }
    }
    return snapshot;
  }

  private reconstructGemini(fullBody: string): any {
    const lines = fullBody.split(/\r?\n/);
    let snapshot: any = null;

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.replace(/^data:\s*/, "").trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        snapshot = this.updateGeminiSnapshot(snapshot, chunk);
      } catch (e) {
        // Skip malformed/non-JSON lines
      }
    }
    return snapshot;
  }

  /**
   * Applies a chunk to the existing snapshot for Gemini.
   */
  private updateGeminiSnapshot(acc: any, chunk: any): any {
    if (!acc) {
      acc = { ...chunk };
      // Ensure candidates and parts arrays are initialized if missing in the first chunk
      if (!acc.candidates) acc.candidates = [];
      return acc;
    }

    // Update top-level fields
    if (chunk.modelVersion) acc.modelVersion = chunk.modelVersion;
    if (chunk.responseId) acc.responseId = chunk.responseId;
    if (chunk.usageMetadata) acc.usageMetadata = chunk.usageMetadata;

    if (chunk.candidates && chunk.candidates.length > 0) {
      if (!acc.candidates) acc.candidates = [];

      chunk.candidates.forEach((chunkCand: any, index: number) => {
        // Ensure candidate exists
        if (!acc.candidates[index]) {
          acc.candidates[index] = { content: { parts: [], role: "model" }, index };
        }
        
        const accCand = acc.candidates[index];

        // Update finishReason if present
        if (chunkCand.finishReason) {
          accCand.finishReason = chunkCand.finishReason;
        }

        if (chunkCand.content && chunkCand.content.parts) {
          if (!accCand.content) accCand.content = { parts: [], role: "model" };
          if (!accCand.content.parts) accCand.content.parts = [];

          const accParts = accCand.content.parts;

          chunkCand.content.parts.forEach((chunkPart: any) => {
            // Logic to merge text parts, or append new parts
            const lastPart = accParts.length > 0 ? accParts[accParts.length - 1] : null;

            if (chunkPart.text) {
              if (lastPart && lastPart.text !== undefined && !lastPart.functionCall) {
                // Append text to the last text part
                lastPart.text += chunkPart.text;
                // Merge other properties if needed (e.g. thought)
                if (chunkPart.thought) lastPart.thought = true;
              } else {
                // New text part
                accParts.push({ ...chunkPart });
              }
            } else {
              // Non-text part (e.g., functionCall), just push it
              // Gemini usually sends function calls as complete objects in the stream (unlike OpenAI deltas)
              accParts.push({ ...chunkPart });
            }
          });
        }
      });
    }

    return acc;
  }

  /**
   * Applies a chunk to the existing snapshot using index-based merging for Anthropic Messages.
   */
  private updateMessagesSnapshot(acc: any, chunk: any): any {
    // 1. Initial State (message_start)
    if (!acc && chunk.type === "message_start") {
      acc = { ...chunk.message };
      if (!acc.content) acc.content = [];
      if (!acc.usage) acc.usage = {};
      return acc;
    }
    
    if (!acc) return chunk;

    switch (chunk.type) {
      case "message_start":
        acc = { ...acc, ...chunk.message };
        if (!acc.content) acc.content = [];
        break;

      case "content_block_start":
        const idx = chunk.index;
        const block = chunk.content_block;
        acc.content[idx] = { ...block };
        
        // Initialize accumulators based on type
        if (block.type === "tool_use") {
          acc.content[idx].partial_json = "";
          acc.content[idx].input = {};
        } else if (block.type === "thinking" || block.type === "thought") {
          const key = block.type === "thinking" ? "thinking" : "thought";
          acc.content[idx][key] = acc.content[idx][key] || "";
        } else if (block.type === "text") {
          acc.content[idx].text = acc.content[idx].text || "";
        }
        break;

      case "content_block_delta":
        const dIdx = chunk.index;
        const delta = chunk.delta;
        
        if (!acc.content[dIdx]) {
           // Fallback initialization if start was missed
           if (delta.type === "input_json_delta") {
             acc.content[dIdx] = { type: "tool_use", partial_json: "", input: {} };
           } else if (delta.type === "thinking_delta" || delta.type === "thought_delta") {
             const type = delta.type === "thinking_delta" ? "thinking" : "thought";
             acc.content[dIdx] = { type, [type]: "" };
           } else {
             acc.content[dIdx] = { type: "text", text: "" };
           }
        }

        const targetBlock = acc.content[dIdx];

        if (delta.type === "text_delta") {
          targetBlock.text = (targetBlock.text || "") + delta.text;
        } else if (delta.type === "thinking_delta") {
          targetBlock.thinking = (targetBlock.thinking || "") + delta.thinking;
        } else if (delta.type === "thought_delta") {
          targetBlock.thought = (targetBlock.thought || "") + delta.thought;
        } else if (delta.type === "input_json_delta") {
          targetBlock.partial_json = (targetBlock.partial_json || "") + delta.partial_json;
          try {
            targetBlock.input = JSON.parse(targetBlock.partial_json);
          } catch (e) {
            // Partial JSON - common during streaming
          }
        }
        break;

      case "message_delta":
        if (chunk.delta) {
          if (chunk.delta.stop_reason) acc.stop_reason = chunk.delta.stop_reason;
          if (chunk.delta.stop_sequence) acc.stop_sequence = chunk.delta.stop_sequence;
        }
        if (chunk.usage) {
          acc.usage = { ...acc.usage, ...chunk.usage };
        }
        break;
    }

    return acc;
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