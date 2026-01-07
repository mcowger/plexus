import { createHash, randomUUID } from 'crypto';

/**
 * Generate a Claude Code OAuth compatible user_id
 * Format: user_{sha256_hash}_account_{account_uuid}_session_{session_uuid}
 *
 * The user hash is computed as SHA256(account_uuid + session_uuid)
 * This matches the Claude Code CLI implementation.
 *
 * @param accountUuid - Account UUID from OAuth metadata
 * @returns Formatted user_id string
 */
export function generateClaudeCodeUserId(accountUuid: string): string {
  // Generate a session UUID for this request
  const sessionUuid = randomUUID();

  // Create SHA256 hash of account + session (matching Claude Code CLI behavior)
  const userHash = createHash('sha256')
    .update(accountUuid + sessionUuid)
    .digest('hex');

  return `user_${userHash}_account_${accountUuid}_session_${sessionUuid}`;
}
