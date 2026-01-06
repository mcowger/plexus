import { ThinkLevel } from "../types/unified";

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

export const getThinkLevel = (thinking_budget: number): ThinkLevel => {
  if (thinking_budget <= 0) return "none";
  if (thinking_budget <= 1024) return "low";
  if (thinking_budget <= 8192) return "medium";
  return "high";
};

export const formatBase64 = (data: string, media_type: string) => {
  if (data.includes("base64")) {
    data = data.split("base64").pop() as string;
    if (data.startsWith(",")) {
      data = data.slice(1);
    }
  }
  return `data:${media_type};base64,${data}`;
};