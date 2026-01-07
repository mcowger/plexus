import { test, expect, describe } from "bun:test";
import { AnthropicTransformer } from "../anthropic";
import type { UnifiedChatRequest } from "../../types/unified";

describe("AnthropicTransformer - Claude Code OAuth System Instruction", () => {
  test("should inject Claude Code system instruction when user_id is present", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [
        { role: "user", content: "Hello" }
      ],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_def456"
      }
    };

    const payload = await transformer.transformRequest(request);

    expect(payload.system).toBeDefined();
    expect(Array.isArray(payload.system)).toBe(true);
    expect(payload.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });
  });

  test("should prepend Claude Code instruction to existing system message", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" }
      ],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_def456"
      }
    };

    const payload = await transformer.transformRequest(request);

    expect(payload.system).toBeDefined();
    expect(Array.isArray(payload.system)).toBe(true);
    expect(payload.system).toHaveLength(2);

    // First element should be Claude Code instruction
    expect(payload.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });

    // Second element should be the original system message
    expect(payload.system[1]).toEqual({
      type: "text",
      text: "You are a helpful assistant."
    });
  });

  test("should not inject system instruction when user_id is absent", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" }
      ],
      max_tokens: 1024,
      stream: false,
      metadata: {}
    };

    const payload = await transformer.transformRequest(request);

    // System should be a simple string, not an array with Claude Code instruction
    expect(payload.system).toBe("You are a helpful assistant.");
  });

  test("should not inject system instruction when user_id format is invalid", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [
        { role: "user", content: "Hello" }
      ],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "invalid_format"
      }
    };

    const payload = await transformer.transformRequest(request);

    // Should not have system field or should not be an array with Claude Code instruction
    expect(payload.system).toBeUndefined();
  });

  test("should require both _account_ and _session_ in user_id", async () => {
    const transformer = new AnthropicTransformer();

    // Missing _session_
    const request1: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_account_b37bb5b5-6c73-4586-94c4-44313833d598"
      }
    };

    const payload1 = await transformer.transformRequest(request1);
    expect(payload1.system).toBeUndefined();

    // Missing _account_
    const request2: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_session_def456"
      }
    };

    const payload2 = await transformer.transformRequest(request2);
    expect(payload2.system).toBeUndefined();
  });

  test("should include metadata.user_id in payload", async () => {
    const transformer = new AnthropicTransformer();
    const userId = "user_abc123_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_def456";
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: userId
      }
    };

    const payload = await transformer.transformRequest(request);

    expect(payload.metadata).toBeDefined();
    expect(payload.metadata.user_id).toBe(userId);
  });

  test("should not include internal metadata fields", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_account_uuid_session_uuid",
        selected_oauth_account: "matt@example.com",
        oauth_project_id: "project-123"
      }
    };

    const payload = await transformer.transformRequest(request);

    expect(payload.metadata).toBeDefined();
    expect(payload.metadata.user_id).toBeDefined();

    // Internal fields should be filtered out
    expect(payload.metadata.selected_oauth_account).toBeUndefined();
    expect(payload.metadata.oauth_project_id).toBeUndefined();
  });

  test("should work with no system message and Claude Code OAuth", async () => {
    const transformer = new AnthropicTransformer();
    const request: UnifiedChatRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
      stream: false,
      metadata: {
        user_id: "user_abc123_account_b37bb5b5-6c73-4586-94c4-44313833d598_session_def456"
      }
    };

    const payload = await transformer.transformRequest(request);

    expect(payload.system).toBeDefined();
    expect(Array.isArray(payload.system)).toBe(true);
    expect(payload.system).toHaveLength(1);
    expect(payload.system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude."
    });
  });
});
