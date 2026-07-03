/**
 * Claude Code billing header construction — v2-native, ported from
 * vendor/eliza/plugins/plugin-anthropic-proxy/src/proxy/billing-
 * fingerprint.ts (see cc-constants.ts's module doc for why this is now
 * de-vendored rather than imported).
 *
 * Builds the `x-anthropic-billing-header` system-prompt text block real
 * Claude Code sends as `system[0]`:
 *   "x-anthropic-billing-header: cc_version=<ver>.<hash>; cc_entrypoint=cli; cch=00000;"
 *
 * The `cch=00000` placeholder is intentional here — `sign-billing.ts`
 * replaces it with a real signature in a later pipeline stage, once the
 * full request body (including this block) is finalized.
 */

import { createHash } from 'node:crypto';
import { BILLING_HASH_INDICES, BILLING_HASH_SALT, CC_VERSION } from './cc-constants';

const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';

/**
 * Computes the 3-hex-char build-hash suffix appended to `cc_version`.
 * SOURCE / algorithm shape: see cc-constants.ts's BILLING_HASH_SALT doc.
 */
function computeBuildHash(firstUserText: string): string {
  const chars = BILLING_HASH_INDICES.map((i) => firstUserText[i] ?? '0').join('');
  const input = `${BILLING_HASH_SALT}${chars}${CC_VERSION}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 3);
}

/**
 * Extracts the first user message's text content, for build-hash
 * computation. Operates on the parsed body (unlike the vendored version,
 * which scanned raw JSON strings to avoid a parse — we already have the
 * parsed object everywhere else in this pipeline, so there's no
 * string-scanning benefit here).
 */
function extractFirstUserText(body: any): string {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const firstUser = messages.find((m: any) => m?.role === 'user');
  if (!firstUser) return '';

  const content = firstUser.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const firstText = content.find((c: any) => c?.type === 'text');
    return typeof firstText?.text === 'string' ? firstText.text : '';
  }
  return '';
}

/**
 * Builds the unsigned billing header text block (system[0]).
 *
 * @param body - Parsed request body, used only to derive the build-hash
 *   suffix from the first user message's text
 */
export function buildBillingHeaderText(body: any): string {
  const firstUserText = extractFirstUserText(body);
  const buildHash = computeBuildHash(firstUserText);
  return `${BILLING_HEADER_PREFIX} cc_version=${CC_VERSION}.${buildHash}; cc_entrypoint=cli; cch=00000;`;
}

export { BILLING_HEADER_PREFIX };
