import { test, expect, describe } from "bun:test";
import { generateClaudeCodeUserId } from "../oauth-helpers";
import { createHash } from "crypto";

describe("generateClaudeCodeUserId", () => {
  test("should generate user_id with correct format", () => {
    const accountUuid = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const userId = generateClaudeCodeUserId(accountUuid);

    // Should match pattern: user_<hash>_account_<uuid>_session_<uuid>
    expect(userId).toMatch(/^user_[a-f0-9]{64}_account_[a-f0-9-]+_session_[a-f0-9-]+$/);

    // Should contain the account UUID
    expect(userId).toContain(`account_${accountUuid}`);
  });

  test("should generate different session UUIDs for same account", () => {
    const accountUuid = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const userId1 = generateClaudeCodeUserId(accountUuid);
    const userId2 = generateClaudeCodeUserId(accountUuid);

    // Should be different due to different session UUIDs
    expect(userId1).not.toBe(userId2);

    // But should both contain the same account UUID
    expect(userId1).toContain(`account_${accountUuid}`);
    expect(userId2).toContain(`account_${accountUuid}`);
  });

  test("should generate SHA256 hash of account + session", () => {
    const accountUuid = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const userId = generateClaudeCodeUserId(accountUuid);

    // Extract the parts
    const parts = userId.split("_");
    const userHash = parts[1];
    const sessionUuid = parts[parts.length - 1];

    // Verify the hash is SHA256 of account + session
    const expectedHash = createHash("sha256")
      .update(accountUuid + sessionUuid)
      .digest("hex");

    expect(userHash).toBe(expectedHash);
  });

  test("should generate valid UUID for session", () => {
    const accountUuid = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const userId = generateClaudeCodeUserId(accountUuid);

    // Extract session UUID
    const parts = userId.split("_");
    const sessionUuid = parts[parts.length - 1];

    // Should be a valid UUID format
    expect(sessionUuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  });

  test("should handle different account UUIDs", () => {
    const accountUuid1 = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const accountUuid2 = "a12bb3c4-5d67-8e90-f1a2-b3c4d5e6f7a8";

    const userId1 = generateClaudeCodeUserId(accountUuid1);
    const userId2 = generateClaudeCodeUserId(accountUuid2);

    expect(userId1).toContain(`account_${accountUuid1}`);
    expect(userId2).toContain(`account_${accountUuid2}`);
    expect(userId1).not.toContain(accountUuid2);
    expect(userId2).not.toContain(accountUuid1);
  });

  test("should create 64-character hex hash", () => {
    const accountUuid = "b37bb5b5-6c73-4586-94c4-44313833d598";
    const userId = generateClaudeCodeUserId(accountUuid);

    // Extract hash portion
    const parts = userId.split("_");
    const userHash = parts[1];

    // SHA256 produces 64 hex characters
    expect(userHash).toHaveLength(64);
    expect(userHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
