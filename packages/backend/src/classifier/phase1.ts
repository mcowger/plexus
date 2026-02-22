import {
  Tier,
  type ClassifierInput,
  type ClassificationResult,
  type ClassifierConfig,
} from './types';

// Precompile regex patterns at module load time (not per invocation)
const HEARTBEAT_PATTERNS: RegExp[] = [
  /^(ping|pong|status|alive|check|heartbeat|noop|ack)[\s?!.]*$/i,
  /^(hey|hi|hello|yo|sup|hola|hiya)[\s?!.]*$/i,
  /^(thanks|thank you|thx|ty|cheers|ta)[\s?!.]*$/i,
  /^(ok|okay|sure|yes|no|yep|nope|yeah|nah|k|kk)[\s?!.]*$/i,
  /^(bye|goodbye|see ya|later|cya)[\s?!.]*$/i,
  /^[.!?\s]*$/, // empty or only punctuation/whitespace
];

const TIER_DIRECTIVE_REGEX = /\bUSE\s+(HEARTBEAT|SIMPLE|MEDIUM|COMPLEX|REASONING)\b/i;

/**
 * Extract the text of the last message with role "user".
 * Searches messages from end backward. Concatenates text parts for multimodal content.
 */
export function extractLastUserMessage(messages: ClassifierInput['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text ?? '')
          .join('');
      }
      return '';
    }
  }
  return '';
}

/**
 * Estimate total input tokens across ALL messages.
 * Uses heuristic: tokens ≈ ceil(totalCharacters / 4).
 */
export function estimateTokens(messages: ClassifierInput['messages']): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // role + framing overhead
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      const textLength = msg.content
        .filter((part) => part.type === 'text')
        .reduce((sum, part) => sum + (part.text?.length ?? 0), 0);
      total += Math.ceil(textLength / 4);
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += Math.ceil(tc.function.name.length / 4);
        total += Math.ceil(tc.function.arguments.length / 4);
      }
    }
  }
  return total;
}

/**
 * Detect if the last user message matches a heartbeat pattern.
 * Returns false immediately if tools are present — heartbeats don't use tools.
 */
export function detectHeartbeat(
  lastUserMessage: string,
  messages: ClassifierInput['messages'],
  hasTools: boolean
): boolean {
  // Requests with tools are never heartbeats
  if (hasTools) {
    return false;
  }

  const trimmed = lastUserMessage.trim();

  // Check regex patterns
  for (const pattern of HEARTBEAT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Additional condition: very short message, few messages
  if (trimmed.length < 20 && messages.length <= 2) {
    return true;
  }

  return false;
}

/**
 * Detect explicit tier directive in the last user message.
 * Returns the matched Tier or null.
 */
export function detectForcedTier(lastUserMessage: string): Tier | null {
  const match = TIER_DIRECTIVE_REGEX.exec(lastUserMessage);
  if (!match) return null;

  const tierName = match[1]!.toUpperCase() as keyof typeof Tier;
  return Tier[tierName] ?? null;
}

/**
 * Detect token overflow — estimated tokens exceed the threshold.
 */
export function detectTokenOverflow(estimatedTokens: number, threshold: number): boolean {
  return estimatedTokens > threshold;
}

/**
 * Run Phase 1: Short-circuit checks.
 * Returns a ClassificationResult if any check matches, or null to continue to Phase 2.
 */
export function runPhase1(
  input: ClassifierInput,
  config: ClassifierConfig
): ClassificationResult | null {
  const lastUserMessage = extractLastUserMessage(input.messages);
  const estimatedTokens = estimateTokens(input.messages);
  const hasTools = (input.tools ?? []).length > 0;

  // Requests with response_format skip heartbeat — they require the scoring pipeline
  const hasResponseFormat =
    input.response_format !== undefined && typeof input.response_format === 'object';

  // Check 1: Heartbeat detection
  if (!hasResponseFormat && detectHeartbeat(lastUserMessage, input.messages, hasTools)) {
    return {
      tier: Tier.HEARTBEAT,
      score: -1.0,
      confidence: 0.95,
      method: 'short-circuit',
      reasoning: 'heartbeat: matched trivial pattern',
      signals: ['heartbeat-pattern'],
      agenticScore: 0.0,
      hasStructuredOutput: false,
    };
  }

  // Check 2: Forced tier directive
  const forcedTier = detectForcedTier(lastUserMessage);
  if (forcedTier !== null) {
    return {
      tier: forcedTier,
      score: -1.0,
      confidence: 1.0,
      method: 'short-circuit',
      reasoning: `forced tier directive: USE ${forcedTier}`,
      signals: ['forced-tier-directive'],
      agenticScore: 0.0,
      hasStructuredOutput: false,
    };
  }

  // Check 3: Token overflow
  if (detectTokenOverflow(estimatedTokens, config.maxTokensForceComplex)) {
    return {
      tier: Tier.COMPLEX,
      score: 0.5,
      confidence: 0.95,
      method: 'short-circuit',
      reasoning: `token overflow: estimated ${estimatedTokens} tokens exceeds ${config.maxTokensForceComplex} threshold`,
      signals: ['token-overflow'],
      agenticScore: 0.0,
      hasStructuredOutput: false,
    };
  }

  return null;
}
