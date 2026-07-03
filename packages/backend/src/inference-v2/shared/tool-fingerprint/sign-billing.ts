/**
 * CCH (Client Consistency Hash) signing — v2-native.
 *
 * BACKGROUND: `cc-billing.ts`'s `buildBillingHeaderText()` (itself ported
 * from vendor/eliza's `buildBillingBlock()`, see cc-constants.ts's module
 * doc for the de-vendoring rationale) computes the `cc_version` build-hash
 * suffix using what the original vendored code's comments describe as real
 * CC's `utils/fingerprint.ts` algorithm (SHA256 over specific message-text
 * character indices, salted). But it always emits the literal placeholder
 * `cch=00000;` for the actual signature — nothing computes a real one.
 * Real Claude Code signs this field per-request. Debug trace
 * 17404760-e986-49b3-8a20-f1a4a469a0ac shows the literal `cch=00000;`
 * reaching Anthropic — a static, trivially-detectable placeholder is itself
 * a deterministic non-CC signal, independent of the tool-array and system-
 * prompt fixes already applied.
 *
 * v1 (`transformers/oauth/oauth-claude.ts`) has a `signAnthropicMessagesBody`
 * step, but it's dead code in v1's own default/live path: v1's
 * `generateBillingHeader` (called first, with `experimentalCCHSigning`
 * defaulting to false) already writes a non-`00000` hash directly via
 * `computeSimpleHash(JSON.stringify(payload))` — a 32-bit rolling checksum,
 * not a real cryptographic hash — so `signAnthropicMessagesBody`'s "only
 * sign if still `00000`" guard never fires. That's the actual behavior to
 * replicate for v2, upgraded to use a real SHA256 (Node's `crypto` module,
 * available with no new dependency) instead of v1's 32-bit checksum, purely
 * because a genuine hash is strictly better than an ad-hoc one — not
 * because either is confirmed to match Anthropic's real algorithm; neither
 * this nor v1 has ever been verified byte-for-byte against real Claude
 * Code's signing. The concrete, confirmed-necessary fix is simply: never
 * send the literal `00000` placeholder.
 */

import { createHash } from 'node:crypto';
import { BILLING_HEADER_PREFIX } from './cc-billing';

const UNSIGNED_CCH_PATTERN = /cch=00000;/;

/**
 * Computes a 5-hex-char signature over the finalized request body (system
 * prompt, tools, messages — everything that will actually be sent), and
 * substitutes it for the `cch=00000;` placeholder in `system[0]`.
 *
 * Must run LAST, after all other request transformations (tool renames,
 * synthetic tool injection/dedupe, system-prompt identity replacement), so
 * the signature reflects exactly what's transmitted — mirroring v1's
 * ordering (tool rename → system inject → sign).
 *
 * @param body - Parsed JSON request body with `system[0].text` starting
 *   with the billing header prefix and containing the unsigned placeholder
 * @returns New body object with the signed billing header (same reference
 *   if there was nothing to sign)
 */
export function signBillingHeader(body: any): any {
  const firstBlock = body?.system?.[0];
  if (!firstBlock || typeof firstBlock.text !== 'string') {
    return body;
  }
  if (!firstBlock.text.startsWith(BILLING_HEADER_PREFIX)) {
    return body;
  }
  if (!UNSIGNED_CCH_PATTERN.test(firstBlock.text)) {
    return body;
  }

  // Hash the body as it stands right now (with the unsigned placeholder) —
  // matches v1's generateBillingHeader, which hashes the payload before the
  // cch value is known/inserted.
  const cch = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 5);

  const signedText = firstBlock.text.replace(UNSIGNED_CCH_PATTERN, `cch=${cch};`);

  return {
    ...body,
    system: [{ ...firstBlock, text: signedText }, ...body.system.slice(1)],
  };
}
