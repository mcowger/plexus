import { getEncoding, type Tiktoken } from 'js-tiktoken';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Tokenizer (o200k_base, lazy singleton with heuristic fallback)
// ---------------------------------------------------------------------------

let _encoder: Tiktoken | null = null;
let _encoderFailed = false;

// js-tiktoken (pure JS, WASM-free for portability) has an O(n²) worst case
// on highly repetitive input. The entropy check below catches that — the
// length cap is a soft guard for atypical real input (e.g. pasted base64
// certificates) where the heuristic is materially faster.
const MAX_TOKENIZE_CHARS = 256_000;
const ENTROPY_SAMPLE_CHARS = 512;
const MIN_UNIQUE_CHARS = 8;

function getEncoder(): Tiktoken | null {
  if (_encoder || _encoderFailed) return _encoder;
  try {
    _encoder = getEncoding('o200k_base');
  } catch (err) {
    _encoderFailed = true;
    logger.warn(
      '[estimate-tokens] o200k_base encoder failed to load; falling back to heuristic',
      err
    );
  }
  return _encoder;
}

/** For tests: force the encoder path off so the heuristic fallback runs. */
export function __setEncoderFailedForTests(failed: boolean): void {
  _encoderFailed = failed;
  if (failed) _encoder = null;
}

/**
 * Cheap entropy check: a long string with very few distinct characters
 * is the worst case for BPE merges. Sampling the prefix is enough — real
 * prose has dozens of distinct characters in any 500-char window.
 *
 * Iterates by Unicode code point (not UTF-16 code unit) so a string of
 * surrogate-pair characters (e.g. emoji) isn't misclassified — `new Set(text)`
 * would split each emoji into two halves and drastically undercount uniqueness.
 */
function looksRepetitive(text: string): boolean {
  const sample = text.length > ENTROPY_SAMPLE_CHARS ? text.slice(0, ENTROPY_SAMPLE_CHARS) : text;
  const unique = new Set<string>();
  for (const ch of sample) {
    unique.add(ch);
    if (unique.size >= MIN_UNIQUE_CHARS) return false;
  }
  return true;
}

/**
 * Counts tokens for a text string. Uses o200k_base via js-tiktoken when
 * available (within ~5–15% of Claude / Gemini tokenizers, exact for OpenAI).
 *
 * Routes to the heuristic when the input would be slow to tokenize:
 *   - longer than MAX_TOKENIZE_CHARS (BPE cost grows non-linearly on
 *     atypical real input like pasted base64), or
 *   - low-entropy (highly repetitive — pathological for BPE merges).
 *
 * Also falls back to the heuristic if the encoder fails to load.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  if (text.length > MAX_TOKENIZE_CHARS || looksRepetitive(text)) {
    return estimateTokensHeuristic(text);
  }
  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch (err) {
      logger.debug('[estimate-tokens] encode failed, using heuristic', err);
    }
  }
  return estimateTokensHeuristic(text);
}

// Pre-compiled regexes for the heuristic — building these on every call adds
// up under high request volume.
const HEURISTIC_RE_WHITESPACE = /\s/g;
const HEURISTIC_RE_BRACKETS = /[{}\[\]]/g;
const HEURISTIC_RE_PUNCT = /[.,;:!?]/g;
const HEURISTIC_RE_NUMBERS = /\d+/g;
const HEURISTIC_RE_URLS = /https?:\/\/\S+/g;
const HEURISTIC_RE_COMPARES = /[=<>!&|]{2}/g;
// Bounded quantifier avoids catastrophic backtracking on long runs of word
// chars (e.g. base64 data) — identifiers in real code fit in 64 chars.
const HEURISTIC_RE_FNCALLS = /\w{1,64}\(/g;
const HEURISTIC_RE_INDENT = /\n {2,}/g;
const HEURISTIC_RE_SPECIAL = /[^\w\s.,;:!?'"()\[\]{}<>\/\\-]/g;

/**
 * Character-density heuristic. Kept as a fallback when the tokenizer is
 * unavailable. ±20–30% variance vs. real tokenizers — worse than o200k_base
 * but good enough to keep enforcement working if the encoder load fails.
 */
export function estimateTokensHeuristic(text: string): number {
  if (!text || text.length === 0) return 0;

  const charCount = text.length;
  let tokenEstimate = charCount / 4;

  const whitespaceCount = (text.match(HEURISTIC_RE_WHITESPACE) || []).length;
  const whitespaceRatio = whitespaceCount / charCount;
  if (whitespaceRatio > 0.15) {
    tokenEstimate *= 0.95;
  } else if (whitespaceRatio < 0.1) {
    tokenEstimate *= 1.1;
  }

  const jsonBrackets = (text.match(HEURISTIC_RE_BRACKETS) || []).length;
  const punctuation = (text.match(HEURISTIC_RE_PUNCT) || []).length;
  const numbers = (text.match(HEURISTIC_RE_NUMBERS) || []).length;
  const urls = (text.match(HEURISTIC_RE_URLS) || []).length;

  tokenEstimate += jsonBrackets * 0.5;
  tokenEstimate += punctuation * 0.3;
  tokenEstimate += numbers * 0.2;
  tokenEstimate += urls * 2;

  const codeIndicators =
    (text.match(HEURISTIC_RE_COMPARES) || []).length +
    (text.match(HEURISTIC_RE_FNCALLS) || []).length +
    (text.match(HEURISTIC_RE_INDENT) || []).length;
  if (codeIndicators > charCount / 100) {
    tokenEstimate *= 1.08;
  }

  const specialChars = (text.match(HEURISTIC_RE_SPECIAL) || []).length;
  tokenEstimate += specialChars * 0.4;

  const uniqueChars = new Set(text).size;
  const repetitionRatio = uniqueChars / charCount;
  if (repetitionRatio < 0.05) {
    tokenEstimate *= 0.9;
  }

  return Math.round(tokenEstimate);
}

// ---------------------------------------------------------------------------
// Image dimension sniffing (PNG / JPEG / GIF / WebP)
// ---------------------------------------------------------------------------

interface ImageDimensions {
  width: number;
  height: number;
}

const DATA_URI_RE = /^data:([^;,]+)?(?:;([^,]*))?,(.*)$/s;

/**
 * Decode a small prefix of the base64 payload to extract image dimensions
 * without doing a full image decode. Returns null on any parse failure;
 * callers fall back to a conservative per-provider default.
 */
export function getImageDimensionsFromDataUri(dataUri: string): ImageDimensions | null {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;

  const match = DATA_URI_RE.exec(dataUri);
  if (!match) return null;
  const params = match[2] ?? '';
  const payload = match[3] ?? '';
  if (!payload) return null;

  let bytes: Buffer;
  try {
    if (params.split(';').some((p) => p.trim().toLowerCase() === 'base64')) {
      // Decode just the prefix — 64 bytes of binary needs ~88 base64 chars.
      // Use 1KB worth of base64 to be safe for JPEG SOF scans.
      const head = payload.slice(0, 4096).replace(/\s+/g, '');
      bytes = Buffer.from(head, 'base64');
    } else {
      // URL-encoded payload (rare for images; handle defensively).
      bytes = Buffer.from(decodeURIComponent(payload.slice(0, 4096)), 'binary');
    }
  } catch {
    return null;
  }

  return getImageDimensionsFromBuffer(bytes);
}

export function getImageDimensionsFromBuffer(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR with width@16, height@20 (BE).
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes.length >= 24
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // GIF: "GIF87a" / "GIF89a", then logical screen width@6 (LE), height@8 (LE).
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61 &&
    bytes.length >= 10
  ) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  // WebP: "RIFF" .... "WEBP" then a chunk header.
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const chunk = bytes.slice(12, 16).toString('ascii');
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      // Lossy: dims at offset 26 (each 14 bits, low byte first).
      const w = bytes.readUInt16LE(26) & 0x3fff;
      const h = bytes.readUInt16LE(28) & 0x3fff;
      return { width: w, height: h };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes.readUInt8(20) === 0x2f) {
      // Lossless: signature 0x2f at offset 20, then 14+14 bits packed.
      const b0 = bytes.readUInt8(21);
      const b1 = bytes.readUInt8(22);
      const b2 = bytes.readUInt8(23);
      const b3 = bytes.readUInt8(24);
      const w = 1 + (((b1 & 0x3f) << 8) | b0);
      const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width: w, height: h };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      // Extended: 24-bit canvas width/height (minus 1) at offsets 24/27.
      const w =
        1 + (bytes.readUInt8(24) | (bytes.readUInt8(25) << 8) | (bytes.readUInt8(26) << 16));
      const h =
        1 + (bytes.readUInt8(27) | (bytes.readUInt8(28) << 8) | (bytes.readUInt8(29) << 16));
      return { width: w, height: h };
    }
  }

  // JPEG: starts with FF D8 FF; scan for SOF marker, then height@+5, width@+7.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes.readUInt8(i) !== 0xff) {
        i++;
        continue;
      }
      // Skip fill bytes (FF FF...).
      while (i < bytes.length && bytes.readUInt8(i) === 0xff) i++;
      if (i >= bytes.length) break;
      const marker = bytes.readUInt8(i);
      i++;
      // Standalone markers (no length): SOI, EOI, RSTn, TEM.
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0x01
      ) {
        continue;
      }
      if (i + 1 >= bytes.length) break;
      const segLen = bytes.readUInt16BE(i);
      // SOFn markers (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC).
      const isSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSOF && i + 7 < bytes.length) {
        return {
          height: bytes.readUInt16BE(i + 3),
          width: bytes.readUInt16BE(i + 5),
        };
      }
      i += segLen;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Image token estimation (per-provider formulas)
// ---------------------------------------------------------------------------

const CLAUDE_DEFAULT_IMAGE_TOKENS = 1600;
const OPENAI_DEFAULT_IMAGE_TOKENS = 1100;
const GEMINI_IMAGE_TOKENS = 258;
const OPENAI_LOW_DETAIL_TOKENS = 85;
const OPENAI_TILE_TOKENS = 170;

interface NormalizedImage {
  dataUri?: string;
  url?: string;
  detail?: 'low' | 'high' | 'auto' | string;
  base64?: string;
  mediaType?: string;
}

function dimensionsFor(image: NormalizedImage): ImageDimensions | null {
  if (image.dataUri) return getImageDimensionsFromDataUri(image.dataUri);
  if (image.base64) {
    const head = image.base64.slice(0, 4096).replace(/\s+/g, '');
    try {
      return getImageDimensionsFromBuffer(Buffer.from(head, 'base64'));
    } catch {
      return null;
    }
  }
  return null;
}

function claudeImageTokens(image: NormalizedImage): number {
  const dims = dimensionsFor(image);
  if (!dims || dims.width <= 0 || dims.height <= 0) return CLAUDE_DEFAULT_IMAGE_TOKENS;
  return Math.min(CLAUDE_DEFAULT_IMAGE_TOKENS, Math.ceil((dims.width * dims.height) / 750));
}

function openaiImageTokens(image: NormalizedImage): number {
  if (image.detail === 'low') return OPENAI_LOW_DETAIL_TOKENS;
  const dims = dimensionsFor(image);
  if (!dims || dims.width <= 0 || dims.height <= 0) return OPENAI_DEFAULT_IMAGE_TOKENS;

  // Fit within 2048×2048 preserving aspect.
  let { width, height } = dims;
  if (width > 2048 || height > 2048) {
    const scale = 2048 / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  // Then short side to 768.
  const shortSide = Math.min(width, height);
  if (shortSide > 768) {
    const scale = 768 / shortSide;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
  return OPENAI_LOW_DETAIL_TOKENS + OPENAI_TILE_TOKENS * tiles;
}

/**
 * Per-provider image-token cost. apiType selects the formula:
 *   - chat / responses → OpenAI vision (low: 85; high: tiled)
 *   - messages         → Anthropic Claude ((w×h)/750, capped)
 *   - gemini           → Google Gemini (fixed 258)
 *   - oauth / unknown  → conservative Claude-equivalent default
 */
export function estimateImageTokens(image: NormalizedImage, apiType: string): number {
  const t = (apiType || '').toLowerCase();
  if (t === 'gemini') return GEMINI_IMAGE_TOKENS;
  if (t === 'messages') return claudeImageTokens(image);
  if (t === 'chat' || t === 'responses') return openaiImageTokens(image);
  return CLAUDE_DEFAULT_IMAGE_TOKENS;
}

// ---------------------------------------------------------------------------
// Structural walker (replaces JSON.stringify-everything)
// ---------------------------------------------------------------------------

function tokensForStringOrJson(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return estimateTokens(value);
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function walkOpenAIContent(content: unknown, apiType: string): number {
  if (content == null) return 0;
  if (typeof content === 'string') return estimateTokens(content);
  if (!Array.isArray(content)) return tokensForStringOrJson(content);

  let total = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, any>;
    const type: string | undefined = p.type;
    if (type === 'text' || type === 'input_text' || type === 'output_text') {
      total += estimateTokens(typeof p.text === 'string' ? p.text : '');
    } else if (type === 'image_url' || type === 'input_image') {
      const img = p.image_url ?? p;
      const url = typeof img === 'string' ? img : img?.url;
      const detail = img?.detail ?? p.detail;
      if (typeof url === 'string' && url.startsWith('data:')) {
        total += estimateImageTokens({ dataUri: url, detail }, apiType);
      } else {
        total += estimateImageTokens({ url, detail }, apiType);
      }
    } else if (type === 'tool_result' || type === 'tool_use' || type === 'function_call') {
      total += tokensForStringOrJson(p);
    } else {
      total += tokensForStringOrJson(p);
    }
  }
  return total;
}

function walkAnthropicContent(content: unknown): number {
  if (content == null) return 0;
  if (typeof content === 'string') return estimateTokens(content);
  if (!Array.isArray(content)) return tokensForStringOrJson(content);

  let total = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, any>;
    const type: string | undefined = p.type;
    if (type === 'text') {
      total += estimateTokens(typeof p.text === 'string' ? p.text : '');
    } else if (type === 'image') {
      const source = p.source ?? {};
      if (source.type === 'base64' && typeof source.data === 'string') {
        total += estimateImageTokens(
          { base64: source.data, mediaType: source.media_type },
          'messages'
        );
      } else if ((source.type === 'url' || source.type === 'image_url') && source.url) {
        total += estimateImageTokens({ url: source.url }, 'messages');
      } else {
        total += estimateImageTokens({}, 'messages');
      }
    } else if (type === 'thinking' && typeof p.thinking === 'string') {
      total += estimateTokens(p.thinking);
    } else if (type === 'tool_use' || type === 'tool_result') {
      total += tokensForStringOrJson(p);
    } else {
      total += tokensForStringOrJson(p);
    }
  }
  return total;
}

function walkGeminiPart(part: unknown): number {
  if (!part || typeof part !== 'object') return 0;
  const p = part as Record<string, any>;
  if (typeof p.text === 'string') return estimateTokens(p.text);
  if (p.inlineData?.data) {
    return estimateImageTokens(
      { base64: p.inlineData.data, mediaType: p.inlineData.mimeType },
      'gemini'
    );
  }
  if (p.fileData) {
    return estimateImageTokens({ url: p.fileData.fileUri }, 'gemini');
  }
  if (p.functionCall || p.functionResponse) {
    return tokensForStringOrJson(p);
  }
  return tokensForStringOrJson(p);
}

function walkMessagesArray(
  messages: unknown,
  apiType: string,
  contentWalker: (content: unknown) => number
): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, any>;
    total += contentWalker(m.content);
    if (m.tool_calls) total += tokensForStringOrJson(m.tool_calls);
    if (m.name && typeof m.name === 'string') total += estimateTokens(m.name);
    if (typeof m.role === 'string') total += estimateTokens(m.role);
  }
  return total;
}

/**
 * Estimate input tokens by walking the message structure and routing each
 * text part through the tokenizer and each image through the per-provider
 * formula. Replaces the legacy JSON.stringify-everything path that vastly
 * over-counted base64 image payloads (~200× error).
 *
 * On unexpected shape, falls back to JSON.stringify + estimateTokens so
 * enforcement never throws.
 */
export function estimateInputTokens(originalBody: any, apiType: string): number {
  if (!originalBody || typeof originalBody !== 'object') return 0;

  try {
    const t = (apiType || '').toLowerCase();
    let total = 0;

    switch (t) {
      case 'chat': {
        total += walkMessagesArray(originalBody.messages, t, (c) => walkOpenAIContent(c, t));
        if (originalBody.tools) total += tokensForStringOrJson(originalBody.tools);
        break;
      }
      case 'messages': {
        total += walkMessagesArray(originalBody.messages, t, walkAnthropicContent);
        if (originalBody.system != null) {
          total += Array.isArray(originalBody.system)
            ? walkAnthropicContent(originalBody.system)
            : tokensForStringOrJson(originalBody.system);
        }
        if (originalBody.tools) total += tokensForStringOrJson(originalBody.tools);
        break;
      }
      case 'gemini': {
        if (Array.isArray(originalBody.contents)) {
          for (const item of originalBody.contents) {
            if (!item || typeof item !== 'object') continue;
            const parts = (item as any).parts;
            if (Array.isArray(parts)) {
              for (const part of parts) total += walkGeminiPart(part);
            }
          }
        }
        if (originalBody.systemInstruction) {
          const sys = originalBody.systemInstruction;
          if (typeof sys === 'string') {
            total += estimateTokens(sys);
          } else if (Array.isArray(sys.parts)) {
            for (const part of sys.parts) total += walkGeminiPart(part);
          } else {
            total += tokensForStringOrJson(sys);
          }
        }
        if (originalBody.tools) total += tokensForStringOrJson(originalBody.tools);
        break;
      }
      case 'responses': {
        if (Array.isArray(originalBody.input)) {
          for (const item of originalBody.input) {
            if (!item || typeof item !== 'object') continue;
            const it = item as Record<string, any>;
            if (typeof it.content !== 'undefined') {
              total += walkOpenAIContent(it.content, t);
            } else {
              total += tokensForStringOrJson(it);
            }
          }
        } else if (typeof originalBody.input === 'string') {
          total += estimateTokens(originalBody.input);
        } else if (originalBody.input != null) {
          total += tokensForStringOrJson(originalBody.input);
        }
        if (originalBody.instructions != null) {
          total +=
            typeof originalBody.instructions === 'string'
              ? estimateTokens(originalBody.instructions)
              : tokensForStringOrJson(originalBody.instructions);
        }
        if (originalBody.tools) total += tokensForStringOrJson(originalBody.tools);
        break;
      }
      default:
        // Defensive fallback for unknown apiType: use legacy stringify path.
        return estimateTokens(JSON.stringify(originalBody));
    }

    return total;
  } catch (err) {
    // Walker hit unexpected shape — fall back to the legacy stringify path
    // so enforcement still gets a conservative estimate. Returning 0 here
    // would let an oversized request slip past enforce-limits.
    logger.error('Failed to estimate input tokens, falling back to stringify:', err);
    try {
      return estimateTokens(JSON.stringify(originalBody));
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Reconstructed-response extraction (unchanged plumbing, tokenizer-routed)
// ---------------------------------------------------------------------------

function extractChatContent(reconstructed: any): { output: string; reasoning: string } {
  let output = '';
  let reasoning = '';

  if (!reconstructed?.choices) return { output, reasoning };

  for (const choice of reconstructed.choices) {
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') output += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.function?.arguments) output += toolCall.function.arguments;
      }
    }
  }

  return { output, reasoning };
}

function extractMessagesContent(reconstructed: any): { output: string; reasoning: string } {
  let output = '';
  let reasoning = '';

  if (!reconstructed?.content || !Array.isArray(reconstructed.content)) {
    return { output, reasoning };
  }

  for (const block of reconstructed.content) {
    if (block.type === 'text' && block.text) {
      output += block.text;
    } else if (block.type === 'thinking' && block.thinking) {
      reasoning += block.thinking;
    } else if (block.type === 'thought' && block.thought) {
      reasoning += block.thought;
    } else if (block.type === 'tool_use' && block.input) {
      output += JSON.stringify(block.input);
    }
  }

  return { output, reasoning };
}

function extractGeminiContent(reconstructed: any): { output: string; reasoning: string } {
  let output = '';
  let reasoning = '';

  if (!reconstructed?.candidates || !Array.isArray(reconstructed.candidates)) {
    return { output, reasoning };
  }

  for (const candidate of reconstructed.candidates) {
    if (!candidate.content?.parts || !Array.isArray(candidate.content.parts)) {
      continue;
    }

    for (const part of candidate.content.parts) {
      if (part.text) {
        if (part.thought === true) {
          reasoning += part.text;
        } else {
          output += part.text;
        }
      } else if (part.functionCall) {
        output += JSON.stringify(part.functionCall);
      }
    }
  }

  return { output, reasoning };
}

function extractOAuthContent(reconstructed: any): { output: string; reasoning: string } {
  let output = '';
  let reasoning = '';

  if (!reconstructed) return { output, reasoning };

  if (typeof reconstructed.content === 'string') output += reconstructed.content;
  if (typeof reconstructed.reasoning_content === 'string') {
    reasoning += reconstructed.reasoning_content;
  }
  if (reconstructed.tool_calls && Array.isArray(reconstructed.tool_calls)) {
    for (const toolCall of reconstructed.tool_calls) {
      if (toolCall?.function?.arguments) output += toolCall.function.arguments;
    }
  }

  return { output, reasoning };
}

export function estimateTokensFromReconstructed(
  reconstructed: any,
  apiType: string
): { output: number; reasoning: number } {
  if (!reconstructed) {
    return { output: 0, reasoning: 0 };
  }

  let outputText = '';
  let reasoningText = '';

  try {
    switch ((apiType || '').toLowerCase()) {
      case 'chat': {
        const c = extractChatContent(reconstructed);
        outputText = c.output;
        reasoningText = c.reasoning;
        break;
      }
      case 'messages': {
        const c = extractMessagesContent(reconstructed);
        outputText = c.output;
        reasoningText = c.reasoning;
        break;
      }
      case 'gemini': {
        const c = extractGeminiContent(reconstructed);
        outputText = c.output;
        reasoningText = c.reasoning;
        break;
      }
      case 'oauth': {
        const c = extractOAuthContent(reconstructed);
        outputText = c.output;
        reasoningText = c.reasoning;
        break;
      }
      default:
        logger.warn(`Unknown API type for token estimation: ${apiType}`);
        return { output: 0, reasoning: 0 };
    }

    return {
      output: estimateTokens(outputText),
      reasoning: estimateTokens(reasoningText),
    };
  } catch (err) {
    logger.error(`Failed to estimate tokens from reconstructed response:`, err);
    return { output: 0, reasoning: 0 };
  }
}
