/**
 * Claude Code `metadata.user_id` injection — v2-native, ported from
 * vendor/eliza/plugins/plugin-anthropic-proxy/src/proxy/process-body.ts's
 * inline metadata-injection step (see cc-constants.ts's module doc for the
 * de-vendoring rationale).
 *
 * Real Claude Code sends a `metadata.user_id` field whose value is itself a
 * JSON string encoding a per-installation `device_id` and a per-process
 * `session_id`:
 *   {"metadata":{"user_id":"{\"device_id\":\"<64 hex chars>\",\"session_id\":\"<uuid>\"}"}}
 *
 * SOURCE: confirmed against a genuine v2-masked request in debug trace
 * 17404760-e986-49b3-8a20-f1a4a469a0ac's `transformedRequest.metadata`
 * field (produced by the vendored pipeline before this de-vendoring).
 * TO UPDATE: capture a real Claude Code CLI request's `metadata` field if
 * Anthropic ever changes this shape.
 */

import { randomBytes, randomUUID } from 'node:crypto';

// Generated once per process — matches real Claude Code's per-installation
// device_id (stable across requests within a process) and per-session
// session_id, mirroring the vendored pipeline's module-level constants.
const DEVICE_ID = randomBytes(32).toString('hex');
const SESSION_ID = randomUUID();

/**
 * Injects (or overwrites) `body.metadata.user_id` with the Claude Code
 * device_id/session_id shape.
 *
 * @param body - Parsed JSON request body
 * @returns New body object with `metadata.user_id` set
 */
export function injectClaudeCodeMetadata(body: any): any {
  const metaValue = JSON.stringify({ device_id: DEVICE_ID, session_id: SESSION_ID });
  return {
    ...body,
    metadata: { ...body.metadata, user_id: metaValue },
  };
}
