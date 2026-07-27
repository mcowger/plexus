import { UnifiedImageGenerationCall } from '../types/unified';

/**
 * Chat-format rendering of Responses API `image_generation_call` output.
 *
 * The unified layer carries completed image items TYPED ONLY
 * (`image_generation_calls`, full base64, never size-capped — see
 * types/unified.ts). Unified `content` stays PURE authored message text.
 * Client-facing renderers that want a text projection of the image (chat,
 * anthropic/messages, gemini, ollama, legacy completions) compose it HERE,
 * from the typed items; the responses-facing formatters re-emit the native
 * item instead and never perform string surgery on the text. That split is
 * what makes authored text that happens to contain the same characters as a
 * rendered image segment (the markdown of a small image, or the oversized
 * placeholder) impossible to corrupt.
 */

// Largest image_generation_call base64 `result` (in characters) that
// renderImageResultMarkdown will inline as a data URI. Anything larger is
// rendered as an omission placeholder instead: the markdown lands in a single
// composed content string / SSE content delta, and a multi-megabyte data URI
// there can blow past client/proxy message-size limits.
export const MAX_INLINE_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;

/**
 * Sniffs the image mime SUBTYPE from the magic bytes at the head of a base64
 * payload. `output_format` is a REQUEST-side image tool field — it is not
 * present on image_generation_call output items — so the payload's own
 * signature is the only reliable source:
 *   - PNG:  \x89 P N G
 *   - JPEG: \xFF \xD8
 *   - WebP: R I F F ...(4 size bytes)... W E B P
 *   - GIF:  G I F 8
 * Anything unrecognized defaults to png. Only the markdown data-URI rendering
 * needs a mime — the native typed re-emit carries raw base64 with no URI.
 */
function sniffImageMimeSubtype(base64Result: string): string {
  // 24 base64 chars decode to 18 bytes — enough for every signature above
  // (WebP needs 12).
  const head = Buffer.from(base64Result.slice(0, 24), 'base64');
  if (
    head.length >= 4 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'png';
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) {
    return 'jpeg';
  }
  if (
    head.length >= 12 &&
    head.toString('latin1', 0, 4) === 'RIFF' &&
    head.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'GIF8') {
    return 'gif';
  }
  return 'png';
}

/**
 * Renders one base64 image `result` as a markdown data-URI image for
 * chat-format text surfaces. Returns null for a missing/empty payload.
 * Results larger than MAX_INLINE_IMAGE_BASE64_CHARS are NOT inlined: a short
 * placeholder text segment (naming the approximate decoded size) is rendered
 * instead, so a huge image can't flood a single content string/SSE delta.
 * The mime subtype is sniffed from the payload's magic bytes (see
 * sniffImageMimeSubtype).
 */
function renderImageResultMarkdown(result: unknown): string | null {
  if (typeof result !== 'string' || result.length === 0) return null;
  if (result.length > MAX_INLINE_IMAGE_BASE64_CHARS) {
    // Base64 decodes to ~3/4 of its character count; report the
    // approximate decoded size with one decimal.
    const approxDecodedMb = ((result.length * 3) / 4 / (1024 * 1024)).toFixed(1);
    return `[generated image omitted: ${approxDecodedMb} MB exceeds inline limit]`;
  }
  const format = sniffImageMimeSubtype(result);
  return `![generated image](data:image/${format};base64,${result})`;
}

/**
 * Renders a COMPLETED image_generation_call output item's base64 `result`
 * as chat-format markdown (minimal-scope rendering: completed items only —
 * partial-image preview deltas are explicitly out of scope, see
 * responses.ts transformStream). Returns null when the item is not an
 * image_generation_call or carries no base64 `result` payload. Size guard
 * and mime sniff per renderImageResultMarkdown.
 */
export function imageGenerationCallMarkdown(item: any): string | null {
  if (!item || item.type !== 'image_generation_call') return null;
  return renderImageResultMarkdown(item.result);
}

/**
 * Composes the client-visible text for a CHAT-FORMAT unary response: the
 * pure authored `content`, followed by one rendered markdown segment per
 * typed image item (data URI, or the oversized placeholder), joined with
 * single `\n`s — the same client-visible bytes the pre-split design baked
 * into unified content.
 *
 * When no image renders (the overwhelmingly common path), the original
 * `content` value is returned UNCHANGED — no coercion, no copy — so
 * image-less responses stay byte-identical through every chat-format
 * formatter that previously passed `content` straight through.
 */
export function composeContentWithImageMarkdown(
  content: string | null | undefined,
  imageGenerationCalls: UnifiedImageGenerationCall[] | undefined
): string | null | undefined {
  const markdownSegments: string[] = [];
  for (const imageCall of imageGenerationCalls ?? []) {
    const markdown = renderImageResultMarkdown(imageCall?.result);
    if (markdown) markdownSegments.push(markdown);
  }
  if (markdownSegments.length === 0) return content;
  return (content ? [content, ...markdownSegments] : markdownSegments).join('\n');
}
