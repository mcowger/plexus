/**
 * A more accurate token counter that accounts for common sub-word patterns.
 * No external dependencies.
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // 1. Common sub-word fragments that usually count as separate tokens
  // in BPE (e.g., GPT-3/4).
  // const subwordPatterns = [...]; (removed unused)

  // 2. Initial split: words, punctuation, and spaces
  const baseTokens = text.match(/\w+|[^\w\s]|\s+/g) || [];
  
  let totalCount = 0;

  for (const token of baseTokens) {
    // Increment for the base word/symbol
    totalCount++;

    // 3. Sub-word logic: 
    // If the word is long (e.g., > 7 chars), it's likely split into multiple tokens.
    // We add a "penalty" count for every 4 characters beyond the first 4.
    if (token.length > 4 && /\w+/.test(token)) {
      totalCount += Math.floor((token.length - 1) / 4);
    }

    // 4. CJK Character logic:
    // Chinese, Japanese, and Korean characters are almost always 1 token each.
    const cjkMatches = token.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
    if (cjkMatches) {
      // We subtract 1 because the base word was already counted, 
      // then add the count of individual CJK characters.
      totalCount += cjkMatches.length - 1;
    }
  }

  return totalCount;
}