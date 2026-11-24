type ContentBlock = { type?: string; text?: unknown; thinking?: unknown } | string | null;

const blockToText = (b: ContentBlock | undefined): string => {
  if (typeof b === 'string') return b;
  if (b?.type === 'thinking') return flatten(b.thinking);
  return flatten(b?.text);
};

const flatten = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v.map((b: ContentBlock) => blockToText(b)).join('');
};

/**
 * Mistral (magistral / large-4) returns `content` as an array of typed blocks
 * (`text`, and `thinking` whose `thinking` field is itself a block array)
 * instead of a string. Split it into the plain text and reasoning strings the
 * unified layer expects; string / nullish content passes through unchanged.
 *
 * Shape-driven rather than provider-gated: the chat wire carries no provider
 * identity (TransformerFactory only sees the wire type), and a plain string
 * `content` is returned untouched, so other upstreams are unaffected.
 */
export function splitContentBlocks(content: unknown): {
  text: string | null | undefined;
  thinking: string | undefined;
} {
  if (!Array.isArray(content))
    return { text: content as string | null | undefined, thinking: undefined };
  let text = '';
  let thinking = '';
  for (const block of content as ContentBlock[]) {
    if (typeof block === 'string') text += block;
    else if (block?.type === 'thinking') thinking += flatten(block.thinking);
    else if (block?.type === 'text') text += flatten(block.text);
  }
  return { text, thinking: thinking || undefined };
}
