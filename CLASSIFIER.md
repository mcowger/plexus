# Request Complexity Classifier — Design & Implementation Specification

## 1. Executive Summary

This document specifies a request complexity classifier that analyzes incoming LLM chat-completion requests and assigns each request a complexity tier. The classifier is **fully local** — it makes no external API calls, performs no LLM inference, and has no runtime dependencies beyond the request payload itself. Target execution time is **< 1ms** per classification.

The classifier takes as input the fields of an OpenAI-compatible chat-completion request (`messages`, `tools`, `tool_choice`, `response_format`, `max_tokens`) and produces a `ClassificationResult` containing a tier label, a continuous numeric score, a calibrated confidence value, a set of explainability signals, and a separate agentic-affinity score.

The design synthesizes techniques from four open-source routing projects, selecting the strongest mechanism from each:

- **Weighted multi-dimension scoring** (14–15 dimension approach from ClawZenMux / ClawRouter) — produces a continuous score that maps to tiers via configurable boundaries.
- **Negative scoring for simple requests** (ClawZenMux) — simple-indicator keywords actively pull the score *below* zero, preventing misclassification when weak complexity signals co-occur.
- **Sigmoid confidence calibration** (ClawZenMux / ClawRouter) — confidence reflects distance from the nearest tier boundary, not a fixed per-rule constant.
- **Heartbeat short-circuit** (ClawRoute) — trivial requests (pings, greetings) are classified in O(1) before any scoring runs.
- **Separate agentic score** (ClawRouter) — tool-use affinity is output as an independent 0–1 value alongside the main tier, allowing downstream routing to select agentic-optimized models without conflating tool complexity with cognitive complexity.

### What This Document Does NOT Cover

- **Model selection / routing**: This classifier outputs a tier and score. The mapping from tier to a specific model, provider, or fallback chain is a separate concern.
- **Cost estimation**: Cost calculations depend on model pricing tables and are handled downstream.
- **Runtime escalation**: The classifier is invoked once per request. There is no post-response re-classification or retry loop.
- **External LLM fallback**: There is no secondary LLM call for ambiguous cases. The classifier always returns a tier (see Phase 5 for ambiguity handling).

---

## 2. Design Principles

1. **Deterministic** — The same input always produces the same output. No randomness, no external state.

2. **Additive weighted dimensions** — Complexity is measured across 16 independent dimensions. Each dimension returns a score in `[-1, 1]`. Scores are combined via weighted sum. This produces a continuous value that can be mapped to any number of tiers by adjusting boundary thresholds.

3. **Explicit negative scoring** — Simple requests must *reduce* the score, not merely fail to increase it. A prompt like "what is 2+2?" should score well below zero, making it robustly `SIMPLE` even if a stray keyword triggers a weak positive signal on another dimension.

4. **Sigmoid confidence calibration** — Confidence is a function of how far the weighted score falls from the nearest tier boundary. Scores deep inside a tier produce high confidence; scores near a boundary produce low confidence. This is computed via a sigmoid function with a single tunable `steepness` parameter.

5. **Short-circuit for trivial cases** — Before running any dimension scoring, the classifier checks for heartbeat patterns and forced-tier directives. These checks are O(1) regex matches and avoid unnecessary work.

6. **Dual output: tier + agentic score** — The main classification produces a cognitive-complexity tier. A separate `agenticScore` (0–1) is produced in parallel, reflecting how much the request involves tool orchestration and multi-step function calling. These are independent axes: a request can be cognitively simple but agentically complex (e.g., "get the weather in three cities").

7. **Explainability via signals** — Every dimension that fires above a threshold appends a human-readable signal string to the output. This allows debugging and auditing of classification decisions without inspecting internals.

8. **All configuration is static, declarative, and overridable** — Keyword lists, dimension weights, tier boundaries, per-dimension scoring thresholds, and confidence parameters are defined as a single configuration object with sensible defaults. The caller may provide a partial override to tune any parameter without modifying source code. No configuration is loaded from disk, environment, or network at classification time — the config object is passed in by the caller or falls back to defaults.

---

## 3. Tier Definitions

The classifier outputs one of five tiers, ordered by increasing complexity. Each tier has a name, a numeric rank (used for comparisons and minimum-tier enforcement), and a description of the type of request it represents.

```typescript
enum Tier {
  HEARTBEAT  = "HEARTBEAT",   // rank 0
  SIMPLE     = "SIMPLE",      // rank 1
  MEDIUM     = "MEDIUM",      // rank 2
  COMPLEX    = "COMPLEX",     // rank 3
  REASONING  = "REASONING",   // rank 4
}

const TIER_RANK: Record<Tier, number> = {
  HEARTBEAT:  0,
  SIMPLE:     1,
  MEDIUM:     2,
  COMPLEX:    3,
  REASONING:  4,
};
```

### Tier Descriptions

| Tier | Rank | Description | Typical Requests |
|---|---|---|
| `HEARTBEAT` | 0 | Trivial pings, greetings, health checks, single-word acknowledgments. Near-zero cognitive load. | `"ping"`, `"hi"`, `"thanks"`, `"status"`, `"alive?"` |
| `SIMPLE` | 1 | Factual lookups, single-step questions, short translations, format conversions. One clear question with one clear answer. | `"What is the capital of France?"`, `"Convert 5km to miles"`, `"Translate 'hello' to Spanish"` |
| `MEDIUM` | 2 | Multi-sentence requests requiring some synthesis, comparison, or light analysis. May involve structured output or moderate-length generation. | `"Compare Python and Go for web backends"`, `"Write a short email declining a meeting"`, `"Summarize this paragraph"` |
| `COMPLEX` | 3 | Technical tasks requiring domain expertise, code generation, multi-step analysis, architecture discussion, or significant creative work. Often involves code blocks, tool schemas, or deep conversation context. | `"Write a React component that..."`, `"Debug this SQL query..."`, `"Design a REST API for..."`, `"Review this pull request..."` |
| `REASONING` | 4 | Tasks requiring explicit chain-of-thought, mathematical proofs, formal logic, multi-step derivations, or deep analytical reasoning. The model must "think through" a problem rather than retrieve or generate. | `"Prove that sqrt(2) is irrational"`, `"Step by step, derive the time complexity of..."`, `"Analyze the logical consistency of these three arguments..."` |

---

## 4. Input and Output Types

### 4.1 Input: What the Classifier Receives

The classifier function accepts a single object representing the relevant fields extracted from an OpenAI-compatible chat-completion request.

```typescript
/**
 * The input to the classifier. Extracted from the raw HTTP request body
 * before classification is invoked.
 */
interface ClassifierInput {
  /**
   * The full messages array from the request body.
   * Must contain at least one message with role "user".
   */
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: Array<{
      function: { name: string; arguments: string };
    }>;
  }>;

  /**
   * Tool definitions declared in the request, if any.
   * Presence of tools is a strong signal for agentic complexity.
   */
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters?: object };
  }>;

  /**
   * Tool choice directive. "auto", "none", "required", or a specific
   * function name object. The presence of an explicit tool_choice
   * (especially "required" or a specific function) is a stronger agentic
   * signal than tools alone.
   */
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };

  /**
   * Requested response format. If this is an object (e.g., json_schema),
   * it is treated as a structured-output request and triggers a minimum
   * tier enforcement of MEDIUM.
   */
  response_format?: { type: string } | undefined;

  /**
   * Requested maximum output tokens. Used only for token-count estimation
   * in the tokenCount dimension. If absent, a default of 4096 is assumed.
   */
  max_tokens?: number;
}
```

### 4.2 Output: What the Classifier Returns

```typescript
/**
 * A single dimension's contribution to the overall score.
 * Produced internally by each dimension scorer, collected for the
 * weighted sum and for signal extraction.
 */
interface DimensionScore {
  /** Machine-readable dimension name. Must match a key in the weights config. */
  name: string;
  /** Score in [-1.0, 1.0]. Negative values push toward SIMPLE. */
  score: number;
  /** Human-readable signal string, or null if the dimension did not fire. */
  signal: string | null;
}

/**
 * The final output of the classifier.
 */
interface ClassificationResult {
  /**
   * The assigned complexity tier. Always present (never null).
   * In ambiguous cases, defaults to MEDIUM.
   */
  tier: Tier;

  /**
   * The raw weighted score from the 16-dimension scoring.
   * Range is approximately [-0.35, 0.55] in practice, but not clamped.
   * For HEARTBEAT short-circuits, this is set to -1.0.
   */
  score: number;

  /**
   * Sigmoid-calibrated confidence in [0, 1].
   * Reflects how far the score is from the nearest tier boundary.
   * High values (> 0.8) mean the classification is unambiguous.
   * Low values (< 0.65) mean the score is near a boundary.
   * For short-circuit results, this is hardcoded (see Phase 1).
   */
  confidence: number;

  /**
   * How the tier was determined.
   * - "short-circuit": Phase 1 early return (heartbeat, forced tier, token overflow)
   * - "rules": Phase 2–5 weighted scoring pipeline
   */
  method: "short-circuit" | "rules";

  /**
   * Human-readable explanation of the classification decision.
   * Includes the primary reason and any adjustments applied.
   * Example: "rules: score=0.23, tier=COMPLEX | upgraded from MEDIUM (structured output)"
   */
  reasoning: string;

  /**
   * List of signals that fired during scoring.
   * Each string identifies a dimension that contributed a non-zero score.
   * Example: ["code-keywords:3", "reasoning-markers:2", "multi-step:1", "tokens:high"]
   */
  signals: string[];

  /**
   * Agentic task affinity score in [0, 1].
   * Independent of the main tier — a request can be SIMPLE tier with
   * high agenticScore (e.g., "call get_weather for Paris").
   * 0.0 = no agentic signals.
   * 0.5+ = moderate agentic signals (may warrant agentic model selection).
   * 0.8+ = strongly agentic request.
   */
  agenticScore: number;

  /**
   * Whether structured output was detected (via response_format or
   * keywords in the prompt). Used downstream for minimum-tier enforcement.
   */
  hasStructuredOutput: boolean;
}
```

---

## 5. Classification Pipeline Overview

The classifier runs five phases in strict order. If any phase produces an early return, subsequent phases are skipped.

```
┌────────────────────────────────────────────┐
│                ClassifierInput                       │
└────────────────────┬──────────────────────┘
               │
                           ▼
        ┌───────────────────┐
              │  Phase 1: Short-Circuit │──→ early return if matched
              │  (heartbeat, forced     │
              │   tier, token overflow) │
              └──────────┬───────────┘
                        │ (no match)
                    ▼
              ┌────────────────┐
         │  Phase 2: 16-Dimension  │──→ produces weightedScore,
              │  Weighted Scoring       │    signals[], agenticScore
         └────────────┬───────────┘
                       │
                  ▼
              ┌────────────────────────┐
              │  Phase 3: Override      │──→ may force tier or
              │  Checks                 │    adjust score
              └────────────┬───────────┘
              │
                 ▼
              ┌────────────────┐
              │  Phase 4: Tier Boundary │──→ maps weightedScore
              │  Mapping                │    to a Tier
              └────────┬───────────┘
                      │
                      ▼
              ┌─────────────┐
              │  Phase 5: Confidence    │──→ sigmoid calibration,
              │  Calibration & Ambiguity│    ambiguity fallback
              └────────────┬───────────┘
                │
                        ▼
              ┌────────────────────┐
            │  ClassificationResult   │
          └────────────────────────┘
```

---

## 6. Phase 1: Pre-Scoring Short-Circuits

Phase 1 performs three checks in order. If any check matches, the classifier returns immediately without running the weighted scoring pipeline. These checks handle trivially classifiable requests at near-zero cost.

### 6.1 Input Extraction

Before any checks, extract these values from the `ClassifierInput`:

```typescript
// Extract the text of the last message with role "user".
// Search messages array from the end. If the last user message has
// string content, use it. If it has array content (multimodal), 
// concatenate all text parts.
// If no user message exists, set lastUserMessage = "".
const lastUserMessage: string = extractLastUserMessage(input.messages);

// Estimate total input tokens across ALL messages.
// Use the heuristic: tokens ≈ ceil(totalCharacters / 4).
// Include system messages, assistant messages, and tool-call argument strings.
// This is a rough estimate — it does not need to be exact.
const estimatedTokens: number = estimateTokens(input.messages);

// Detect whether tools are declared.
const hasTools: boolean = (input.tools ?? []).length > 0;

// Detect whether an explicit tool_choice is set (not "auto" or "none").
const hasExplicitToolChoice: boolean =
  input.tool_choice !== undefined &&
  input.tool_choice !== "auto" &&
  input.tool_choice !== "none";
```

The `extractLastUserMessage` function must:
1. Iterate `messages` from the end backward.
2. Find the first entry with `role === "user"`.
3. If `content` is a string, return it.
4. If `content` is an array (multimodal), concatenate all items where `item.type === "text"` and return the joined string.
5. If no user message is found, return `""`.

The `estimateTokens` function must:
1. Iterate all messages.
2. For each message, add 4 tokens overhead (role + framing).
3. If `content` is a string, add `ceil(content.length / 4)`.
4. If `content` is an array, add `ceil(totalTextLength / 4)` for text parts.
5. If `tool_calls` is present, add `ceil(name.length / 4) + ceil(arguments.length / 4)` for each tool call.
6. Return the total.

### 6.2 Check 1: Heartbeat Detection

If the last user message matches any heartbeat pattern, return immediately.

**Heartbeat patterns** (case-insensitive, tested against `lastUserMessage.trim()`):

```typescript
const HEARTBEAT_PATTERNS: RegExp[] = [
  /^(ping|pong|status|alive|check|heartbeat|noop|ack)[\s?!.]*$/i,
  /^(hey|hi|hello|yo|sup|hola|hiya)[\s?!.]*$/i,
  /^(thanks|thank you|thx|ty|cheers|ta)[\s?!.]*$/i,
  /^(ok|okay|sure|yes|no|yep|nope|yeah|nah|k|kk)[\s?!.]*$/i,
  /^(bye|goodbye|see ya|later|cya)[\s?!.]*$/i,
  /^[.!?\s]*$/,  // empty or only punctuation/whitespace
];
```

**Additional heartbeat condition**: If `lastUserMessage.length < 20` AND the message array has `<= 2` messages AND `hasTools === false`, classify as heartbeat. This catches ultra-short greetings that may not match the regex exactly.

**Return value for heartbeat match**:

```typescript
return {
  tier: Tier.HEARTBEAT,
  score: -1.0,
  confidence: 0.95,
  method: "short-circuit",
  reasoning: "heartbeat: matched trivial pattern",
  signals: ["heartbeat-pattern"],
  agenticScore: 0.0,
  hasStructuredOutput: false,
};
```

### 6.3 Check 2: Forced Tier Directive

Scan the last user message for an explicit tier directive. The directive is a case-insensitive match of `USE <TIER>` where `<TIER>` is one of the five tier names.
```typescript
const TIER_DIRECTIVE_REGEX = /\bUSE\s+(HEARTBEAT|SIMPLE|MEDIUM|COMPLEX|REASONING)\b/i;
```

If matched:

1. Extract the tier name from the capture group.
2. Convert to uppercase and map to the `Tier` enum.
3. Return immediately:

```typescript
return {
  tier: matchedTier,
  score: -1.0,       // not computed via scoring
  confidence: 1.0,   // forced — full confidence
  method: "short-circuit",
  reasoning: `forced tier directive: USE ${matchedTier}`,
  signals: ["forced-tier-directive"],
  agenticScore: 0.0,
  hasStructuredOutput: false,
};
```

**Important**: The forced tier directive is for classification only. The implementation should NOT strip or modify the directive from the message content. Message mutation is the responsibility of the caller, not the classifier.

### 6.4 Check 3: Large Token Count

If the estimated input token count exceeds a configurable threshold, short-circuit to `COMPLEX`. This is a pragmatic routing guard rather than a true complexity signal — large contexts need models with large context windows, which tend to be higher-tier models.

```typescript
const MAX_TOKENS_FORCE_COMPLEX: number = 100_000;
```

If `estimatedTokens > MAX_TOKENS_FORCE_COMPLEX`:

```typescript
return {
  tier: Tier.COMPLEX,
  score: 0.50,
  confidence: 0.95,
  method: "short-circuit",
  reasoning: `token overflow: estimated ${estimatedTokens} tokens exceeds ${MAX_TOKENS_FORCE_COMPLEX} threshold`,
  signals: ["token-overflow"],
  agenticScore: 0.0,
  hasStructuredOutput: false,
};
```

**Rationale**: A very large token count does not inherently mean the task is difficult — a 100k-token request could be a straightforward summarization. This short-circuit exists as a pragmatic routing guard: it ensures the request is sent to a model with a sufficiently large context window, which tends to correlate with higher-tier model offerings. It is classified as COMPLEX rather than REASONING because large context alone says nothing about whether chain-of-thought reasoning is needed. If downstream routing already handles context-window filtering independently, this threshold can be raised or removed entirely.

### 6.5 Phase 1 Summary

If none of the three checks match, proceed to Phase 2.

---

## 7. Phase 2: Weighted 16-Dimension Scoring

Phase 2 is the core of the classifier. It evaluates 16 independent dimensions of the request, producing a `DimensionScore` for each. The scores are combined via weighted sum into a single `weightedScore`.

### 7.1 Text Preparation

Before scoring dimensions, prepare two text values:

```typescript
// Full text: system prompt + all user/assistant messages concatenated.
// Used by most dimensions because system prompts often contain 
// complexity-relevant instructions.
const fullText: string = input.messages
  .map(m => typeof m.content === "string" ? m.content : "")
  .join("\n")
  .toLowerCase();

// User-only text: only messages with role "user", concatenated.
// Used ONLY by the reasoningMarkers dimension, because reasoning
// keywords in system prompts (e.g., "think step by step") are
// injected by the application, not the user, and should not
// influence complexity classification.
const userText: string = input.messages
  .filter(m => m.role === "user")
  .map(m => typeof m.content === "string" ? m.content : "")
  .join("\n")
  .toLowerCase();
```

Also compute `messageCount`:

```typescript
const messageCount: number = input.messages.length;
```

### 7.2 Dimension Overview Table

Each dimension has a name (string key), a weight (float summing to 1.0 across all 16), and scoring logic that returns a `DimensionScore`.

| # | Dimension Name | Weight | Input Text | Score Range | Direction |
|---|---|---|---|
| 1 | `tokenCount` | 0.08 | — (uses `estimatedTokens`) | [-0.5, 1.0] | + pushes toward COMPLEX |
| 2 | `codePresence` | 0.14 | `fullText` | [0, 1.0] | + pushes toward COMPLEX |
| 3 | `reasoningMarkers` | 0.18 | `userText` (only) | [0, 1.0] | + pushes toward REASONING |
| 4 | `multiStepPatterns` | 0.12 | `fullText` | [0, 1.0] | + pushes toward COMPLEX |
| 5 | `simpleIndicators` | 0.10 | `fullText` | [-1.0, 0] | - pushes toward SIMPLE |
| 6 | `technicalTerms` | 0.08 | `fullText` | [0, 0.8] | + pushes toward COMPLEX |
| 7 | `agenticTask` | 0.06 | `fullText` | [0, 1.0] | + pushes toward COMPLEX (also sets `agenticScore`) |
| 8 | `toolPresence` | 0.05 | — (uses `hasTools`, `hasExplicitToolChoice`) | [0, 1.0] | + pushes toward COMPLEX |
| 9 | `questionComplexity` | 0.04 | `fullText` | [-0.3, 0.7] | mixed |
| 10 | `creativeMarkers` | 0.03 | `fullText` | [0, 0.7] | + pushes toward MEDIUM/COMPLEX |
| 11 | `constraintCount` | 0.03 | `fullText` | [0, 0.8] | + pushes toward COMPLEX |
| 12 | `outputFormat` | 0.03 | `fullText` + `response_format` | [0, 0.8] | + pushes toward MEDIUM/COMPLEX |
| 13 | `conversationDepth` | 0.02 | — (uses `messageCount`) | [0, 0.7] | + pushes toward COMPLEX |
| 14 | `imperativeVerbs` | 0.02 | `fullText` | [0, 0.5] | + weak push toward COMPLEX |
| 15 | `referenceComplexity` | 0.01 | `fullText` | [0, 0.5] | + weak push toward COMPLEX |
| 16 | `negationComplexity` | 0.01 | `fullText` | [0, 0.3] | + very weak push |
| | **Total** | **1.00** | | | |

### 7.3 Dimension Scoring Logic (Detail for Each Dimension)

Below is the scoring logic for each dimension using the **default** threshold and score values. All numeric thresholds (e.g., token count breakpoints, keyword match counts that trigger different score levels) and the score values themselves (e.g., returning 0.5 vs 0.3 for a given match count) must be sourced from the configuration object, not hardcoded. The values shown in the pseudocode below are the defaults from Section 12. See Section 14.2 for the configuration mechanism.

The implementing agent must implement each as a function with signature:

```typescript
function scoreDimensionName(/* inputs */, config: ClassifierConfig): DimensionScore
```

Where `DimensionScore` is `{ name: string; score: number; signal: string | null }`.

---

#### Dimension 1: `tokenCount`

**Purpose**: Longer requests are generally more complex. Very short requests are simpler.

**Input**: `estimatedTokens` (number).

**Logic**:

```
if estimatedTokens < 50:
    score = -0.5
    signal = "tokens:very-short"
else if estimatedTokens < 200:
    score = 0.0
    signal = null           // neutral — no signal emitted
else if estimatedTokens < 500:
    score = 0.3
    signal = "tokens:moderate"
else if estimatedTokens < 2000:
    score = 0.5
    signal = "tokens:long"
else:
    score = 1.0
    signal = "tokens:very-long"
```

Return `{ name: "tokenCount", score, signal }`.

---

#### Dimension 2: `codePresence`

**Purpose**: Detect code blocks and programming keywords. Code in the request strongly indicates COMPLEX.

**Input**: `fullText` (string).

**Logic**:

1. Count `codeBlockMatches`: number of occurrences of the pattern `` ``` `` (triple-backtick) in `fullText`. Since each code block has an opening and closing triple-backtick, divide by 2 (round down) to get the number of code blocks. Minimum 0.
2. Count `codeKeywordMatches`: number of matches from the `CODE_KEYWORDS` list (see Section 10) found in `fullText`. Use word-boundary matching (each keyword is tested with `\b...\b` or as a substring depending on the keyword — see keyword list notes).

```
codeSignals = codeBlockMatches + codeKeywordMatches

if codeSignals == 0:
    score = 0.0
    signal = null
else if codeSignals <= 2:
    score = 0.5
    signal = "code-keywords:{codeSignals}"
else:
    score = 1.0
    signal = "code-keywords:{codeSignals}"
```

Return `{ name: "codePresence", score, signal }`.

---

#### Dimension 3: `reasoningMarkers`

**Purpose**: Detect markers indicating the user wants chain-of-thought, proof, or derivation. This is the highest-weighted dimension because reasoning tasks are the most critical to classify correctly (sending them to a cheap model produces bad results).

**Input**: `userText` only. **Do not use `fullText`**. System prompts frequently contain "think step by step" or similar instructions that are injected by the application framework, not the user. Scoring them would inflate the reasoning signal on every request.

**Logic**:

1. Count `reasoningMatches`: number of matches from `REASONING_KEYWORDS` (see Section 10) found in `userText`.

```
if reasoningMatches == 0:
    score = 0.0
    signal = null
else if reasoningMatches == 1:
    score = 0.5
    signal = "reasoning-markers:1"
else:
    score = 1.0
    signal = "reasoning-markers:{reasoningMatches}"
```

**Side effect**: Store `reasoningMatches` — it is used in Phase 3 for the REASONING override check.

Return `{ name: "reasoningMarkers", score, signal }`.

---

#### Dimension 4: `multiStepPatterns`

**Purpose**: Detect requests that describe a sequence of steps, indicating procedural or multi-part work.

**Input**: `fullText` (string).

**Logic**:

Test the following patterns against `fullText`. Count the number of **distinct** patterns that match (not the total number of matches).

```typescript
const MULTI_STEP_PATTERNS: RegExp[] = [
  /first\s*[,.]?\s*then/i,               // "first X, then Y"
  /step\s+\d/i,                     // "step 1", "step 2"
  /\d+\)\s/,                        // "1) ", "2) "
  /\d+\.\s+[A-Z]/,                 // "1. Do X" (numbered list with capital)
  /phase\s+\d/i,          // "phase 1", "phase 2"
  /\bfirst\b.*\bsecond\b.*\bthird\b/is,   // "first... second... third..."
  /\bthen\b.*\bafter that\b/is,           // "then... after that..."
  /\bfinally\b/i,                     // "finally" (implies prior steps)
];
```

```
matchCount = number of distinct patterns that matched (0 to 8)

if matchCount == 0:
    score = 0.0
    signal = null
else if matchCount == 1:
    score = 0.4
    signal = "multi-step:1"
else if matchCount == 2:
    score = 0.7
    signal = "multi-step:2"
else:
    score = 1.0
    signal = "multi-step:{matchCount}"
```

Return `{ name: "multiStepPatterns", score, signal }`.

---

#### Dimension 5: `simpleIndicators`

**Purpose**: Detect keywords and patterns that indicate a trivially simple request. This dimension returns **negative scores only**, actively pulling the weighted score below zero. This is critical for preventing false-positive MEDIUM classifications on genuinely simple requests that happen to trigger weak signals on other dimensions.

**Input**: `fullText` (string).

**Logic**:

1. Count `simpleMatches`: number of matches from `SIMPLE_KEYWORDS` (see Section 10) found in `fullText`.

```
if simpleMatches == 0:
    score = 0.0
    signal = null
else if simpleMatches <= 2:
    score = -0.5
    signal = "simple-indicators:{simpleMatches}"
else:
    score = -1.0
    signal = "simple-indicators:{simpleMatches}"
```

Return `{ name: "simpleIndicators", score, signal }`.

---

#### Dimension 6: `technicalTerms`

**Purpose**: Detect domain-specific technical vocabulary that indicates specialized knowledge is needed.

**Input**: `fullText` (string).

**Logic**:

1. Count `techMatches`: number of matches from `TECHNICAL_KEYWORDS` (see Section 10).

```
if techMatches == 0:
    score = 0.0
    signal = null
else if techMatches <= 2:
    score = 0.3
    signal = "technical-terms:{techMatches}"
else if techMatches <= 5:
    score = 0.6
    signal = "technical-terms:{techMatches}"
else:
    score = 0.8
    signal = "technical-terms:{techMatches}"
```

Return `{ name: "technicalTerms", score, signal }`.

---

#### Dimension 7: `agenticTask`

**Purpose**: Detect agentic workflow keywords. This dimension serves two purposes: it contributes to the weighted score (pushing toward COMPLEX), and it produces a separate `agenticScore` that is reported independently in the output.

**Input**: `fullText` (string).

**Logic**:

1. Count `agenticMatches`: number of matches from `AGENTIC_KEYWORDS` (see Section 10).

```
if agenticMatches == 0:
    dimensionScore = 0.0
    agenticScore = 0.0
    signal = null
else if agenticMatches <= 2:
    dimensionScore = 0.3
    agenticScore = 0.2
    signal = "agentic-task:{agenticMatches}"
else if agenticMatches == 3:
    dimensionScore = 0.6
    agenticScore = 0.6
    signal = "agentic-task:{agenticMatches}"
else:
    dimensionScore = 1.0
    agenticScore = 1.0
    signal = "agentic-task:{agenticMatches}"
```

**Side effect**: Store `agenticScore` — it is included directly in the final `ClassificationResult`.

Return `{ name: "agenticTask", score: dimensionScore, signal }`.

---

#### Dimension 8: `toolPresence`

**Purpose**: Detect whether tools (function definitions) are declared in the request. Tool schemas indicate the model must perform function calling, which is a distinct complexity signal. An explicit `tool_choice` (especially `"required"` or a specific function) is a stronger signal than tools alone.

**Input**: `hasTools` (boolean), `hasExplicitToolChoice` (boolean).

**Logic**:

```
if !hasTools:
    score = 0.0
    signal = null
else if hasExplicitToolChoice:
    score = 1.0
    signal = "tools-with-explicit-choice"
else:
    score = 0.6
    signal = "tools-present"
```

**Side effect**: If `hasTools` is true and `agenticScore` (from dimension 7) is currently 0.0, set `agenticScore = 0.3`. This ensures that any request with tools declared gets at least a baseline agentic score, even if no agentic keywords are present.

Return `{ name: "toolPresence", score, signal }`.

---

#### Dimension 9: `questionComplexity`

**Purpose**: Count the number of distinct questions. A single question is simple; multiple questions indicate compound requests.

**Input**: `fullText` (string).

**Logic**:

1. Count `questionCount`: number of `?` characters in `fullText`.

```
if questionCount == 0:
    score = 0.0
    signal = null
else if questionCount == 1:
    score = -0.3       // single question is a simplicity signal
    signal = "questions:single"
else if questionCount <= 3:
    score = 0.3
    signal = "questions:{questionCount}"
else:
    score = 0.7
    signal = "questions:{questionCount}"
```

Return `{ name: "questionComplexity", score, signal }`.

---

#### Dimension 10: `creativeMarkers`

**Purpose**: Detect requests for creative content (stories, essays, poetry). These require more capable models but are not "reasoning" tasks.

**Input**: `fullText` (string).

**Logic**:

1. Count `creativeMatches`: matches from `CREATIVE_KEYWORDS` (see Section 10).

```
if creativeMatches == 0:
    score = 0.0
    signal = null
else if creativeMatches <= 2:
  score = 0.3
    signal = "creative-markers:{creativeMatches}"
else:
    score = 0.7
    signal = "creative-markers:{creativeMatches}"
```

Return `{ name: "creativeMarkers", score, signal }`.

---

#### Dimension 11: `constraintCount`

**Purpose**: Detect constraint indicators — phrases that add requirements or conditions the model must satisfy.

**Input**: `fullText` (string).

**Logic**:

1. Count `constraintMatches`: matches from `CONSTRAINT_KEYWORDS` (see Section 10).

```
if constraintMatches == 0:
    score = 0.0
    signal = null
else if constraintMatches <= 2:
    score = 0.3
    signal = "constraints:{constraintMatches}"
else:
    score = 0.8
    signal = "constraints:{constraintMatches}"
```

Return `{ name: "constraintCount", score, signal }`.

---

#### Dimension 12: `outputFormat`

**Purpose**: Detect requests for structured output (JSON, YAML, CSV, tables, schemas). Structured output requires more precise generation. Also sets the `hasStructuredOutput` flag.

**Input**: `fullText` (string), `input.response_format`.

**Logic**:

1. Check if `input.response_format` is an object with `type !== "text"` (i.e., `json_object` or `json_schema`). If so, `formatFromApi = true`.
2. Count `formatMatches`: matches from `OUTPUT_FORMAT_KEYWORDS` (see Section 10) in `fullText`.

```
if formatFromApi:
    score = 0.8
    hasStructuredOutput = true
    signal = "output-format:api-response-format"
else if formatMatches >= 2:
    score = 0.6
    hasStructuredOutput = true
    signal = "output-format:{formatMatches}"
else if formatMatches == 1:
    score = 0.3
    hasStructuredOutput = true
    signal = "output-format:{formatMatches}"
else:
    score = 0.0
    hasStructuredOutput = false
    signal = null
```

**Side effect**: Store `hasStructuredOutput` — it is used in Phase 3 for minimum-tier enforcement and included in the final result.

Return `{ name: "outputFormat", score, signal }`.

---

#### Dimension 13: `conversationDepth`

**Purpose**: Longer conversations (more messages) generally indicate more complex multi-turn interactions.

**Input**: `messageCount` (number).

**Logic**:

```
if messageCount <= 2:
    score = 0.0
    signal = null
else if messageCount <= 6:
    score = 0.2
    signal = "conversation-depth:{messageCount}"
else if messageCount <= 12:
    score = 0.5
    signal = "conversation-depth:{messageCount}"
else:
    score = 0.7
    signal = "conversation-depth:{messageCount}"
```

Return `{ name: "conversationDepth", score, signal }`.

---

#### Dimension 14: `imperativeVerbs`

**Purpose**: Detect strong action verbs that indicate the user is asking the model to perform a concrete task rather than answer a question.

**Input**: `fullText` (string).

**Logic**:

1. Count `verbMatches`: matches from `IMPERATIVE_KEYWORDS` (see Section 10).

```
if verbMatches == 0:
    score = 0.0
    signal = null
else if verbMatches <= 3:
    score = 0.3
    signal = "imperative-verbs:{verbMatches}"
else:
    score = 0.5
    signal = "imperative-verbs:{verbMatches}"
```

Return `{ name: "imperativeVerbs", score, signal }`.

---

#### Dimension 15: `referenceComplexity`

**Purpose**: Detect references to external artifacts (files, URLs, documents, previous conversations).

**Input**: `fullText` (string).

**Logic**:

1. Count `refMatches`: matches from `REFERENCE_KEYWORDS` (see Section 10).

```
if refMatches == 0:
    score = 0.0
    signal = null
else:
    score = min(refMatches * 0.2, 0.5)
    signal = "references:{refMatches}"
```

Return `{ name: "referenceComplexity", score, signal }`.

---

#### Dimension 16: `negationComplexity`
**Purpose**: Detect negation patterns ("don't", "must not", "avoid", "without"). Negation adds constraint complexity but is a weak signal.

**Input**: `fullText` (string).

**Logic**:

1. Count `negMatches`: matches from `NEGATION_KEYWORDS` (see Section 10).

```
if negMatches == 0:
    score = 0.0
    signal = null
else:
    score = min(negMatches * 0.1, 0.3)
    signal = "negation:{negMatches}"
```

Return `{ name: "negationComplexity", score, signal }`.

---

### 7.4 Weighted Score Calculation

After computing all 16 `DimensionScore` values, calculate the weighted score:

```typescript
const DIMENSION_WEIGHTS: Record<string, number> = {
  tokenCount:          0.08,
  codePresence:        0.14,
  reasoningMarkers:    0.18,
  multiStepPatterns:   0.12,
  simpleIndicators:    0.10,
  technicalTerms:      0.08,
  agenticTask:         0.06,
  toolPresence:        0.05,
  questionComplexity:  0.04,
  creativeMarkers:     0.03,
  constraintCount:     0.03,
  outputFormat:        0.03,
  conversationDepth:   0.02,
  imperativeVerbs:     0.02,
  referenceComplexity: 0.01,
  negationComplexity:  0.01,
  // sum = 1.00
};

let weightedScore = 0;
for (const dim of allDimensionScores) {
  const weight = DIMENSION_WEIGHTS[dim.name] ?? 0;
  weightedScore += dim.score * weight;
}
```

Also collect the signals array:

```typescript
const signals: string[] = allDimensionScores
  .filter(d => d.signal !== null)
  .map(d => d.signal!);
```

### 7.5 Phase 2 Outputs

Phase 2 produces the following values for use in subsequent phases:

- `weightedScore` (number) — the combined weighted score
- `signals` (string[]) — human-readable fired signals
- `agenticScore` (number) — separate 0–1 agentic affinity
- `hasStructuredOutput` (boolean) — from outputFormat dimension
- `reasoningMatches` (number) — count from reasoningMarkers dimension

All of these are passed to Phase 3.

---

## 8. Phase 3: Override Checks

Phase 3 applies deterministic overrides that can force a tier or adjust the weighted score before tier boundary mapping. Overrides are checked in order; each override may modify `weightedScore`, force a specific tier, or adjust confidence. If a tier is forced by an override, Phases 4 and 5 are **still executed** but the forced tier takes precedence over the boundary-mapped tier.

The mutable state entering Phase 3:

```typescript
let overrideTier: Tier | null = null;   // null = no override, let boundaries decide
let overrideConfidence: number | null = null;
let reasoning: string = `rules: score=${weightedScore.toFixed(3)}`;
// weightedScore, signals, agenticScore, hasStructuredOutput, reasoningMatches 
// are carried from Phase 2
```

### 8.1 Override 1: Direct REASONING on Multiple Reasoning Markers

If the user text contains **2 or more** reasoning keyword matches, force REASONING regardless of the weighted score. This override exists because reasoning tasks are the most expensive to misclassify (a cheap model will produce incorrect proofs/derivations), and 2+ reasoning markers are a near-certain indicator.

```
if reasoningMatches >= 2:
    overrideTier = Tier.REASONING
    overrideConfidence = max(0.85, <whatever Phase 5 would compute>)
    reasoning += " | override: 2+ reasoning markers → REASONING"
    // Ensure weightedScore is at least 0.40 (the REASONING boundary)
    // so that confidence calibration in Phase 5 produces a high value
    weightedScore = max(weightedScore, 0.42)
```

### 8.2 Override 2: Architecture / Design Signal

Detect requests about system architecture or software design that involve scale or design decisions. These are COMPLEX even if the weighted score is low (e.g., a short prompt "design a microservices architecture" may not accumulate many keyword hits across dimensions).

**Detection logic**:

```typescript
function hasArchitectureSignal(text: string): boolean {
  const ARCHITECTURE_NOUNS = /\b(architecture|microservice|infrastructure|system design|distributed system|scalab|pipeline|data model|schema design|api design)\b/i;
  const DESIGN_VERBS = /\b(design|architect|plan|scale|model|structure|organize|orchestrat)\b/i;
  return ARCHITECTURE_NOUNS.test(text) && DESIGN_VERBS.test(text);
}
```

**Both** an architecture noun AND a design verb must be present.

```
if overrideTier is null AND hasArchitectureSignal(fullText):
    overrideTier = Tier.COMPLEX
    overrideConfidence = 0.82
    weightedScore = max(weightedScore, 0.22)
    reasoning += " | override: architecture-design → COMPLEX"
    signals.push("architecture-design")
```

### 8.3 Override 3: Structured Output Minimum Tier

If structured output was detected (from Phase 2's `hasStructuredOutput`), enforce a minimum tier of MEDIUM. This is because structured output (JSON, YAML, schemas) requires more precise generation than free-text responses, and SIMPLE-tier models may produce malformed output.
This override does **not** set `overrideTier` directly — instead it acts as a floor that is applied after boundary mapping in Phase 4. Record a flag:

```
let structuredOutputMinTier: Tier = Tier.MEDIUM;
let enforceStructuredMin: boolean = hasStructuredOutput;
```

This flag is consumed in Phase 4 (section 9.2).

### 8.4 Phase 3 Outputs

Phase 3 produces:

- `overrideTier` (Tier | null) — if non-null, this tier is used instead of the boundary-mapped tier
- `overrideConfidence` (number | null) — if non-null, this is the minimum confidence
- `weightedScore` — possibly adjusted upward by overrides
- `enforceStructuredMin` (boolean) — whether to enforce structured output minimum tier
- `reasoning` (string) — updated with override explanations
- `signals` (string[]) — possibly updated with override signals

---

## 9. Phase 4: Tier Boundary Mapping

Phase 4 maps the `weightedScore` to a tier using configurable boundary thresholds.

### 9.1 Boundary Configuration

The tier boundaries are read from `config.tierBoundaries`. The values below are the **defaults**. Operators can shift these to make classification more or less aggressive — for example, lowering `mediumComplex` causes more requests to reach COMPLEX, while raising it keeps more requests in MEDIUM.

```typescript
// Default values — override via config.tierBoundaries
const TIER_BOUNDARIES = {
  simpleMedium:     0.00,   // scores below this → SIMPLE
  mediumComplex:    0.20,   // scores below this → MEDIUM
  complexReasoning: 0.40,   // scores below this → COMPLEX, at or above → REASONING
};
```

**Mapping rules** (applied in order):

```
if weightedScore < TIER_BOUNDARIES.simpleMedium:
    mappedTier = Tier.SIMPLE
  lowerBound = -Infinity
    upperBound = TIER_BOUNDARIES.simpleMedium

else if weightedScore < TIER_BOUNDARIES.mediumComplex:
    mappedTier = Tier.MEDIUM
    lowerBound = TIER_BOUNDARIES.simpleMedium
    upperBound = TIER_BOUNDARIES.mediumComplex

else if weightedScore < TIER_BOUNDARIES.complexReasoning:
    mappedTier = Tier.COMPLEX
    lowerBound = TIER_BOUNDARIES.mediumComplex
    upperBound = TIER_BOUNDARIES.complexReasoning

else:
    mappedTier = Tier.REASONING
    lowerBound = TIER_BOUNDARIES.complexReasoning
    upperBound = +Infinity
```

Also compute `distanceFromBoundary` — the minimum distance from the score to either edge of its tier's range:

```
if mappedTier == Tier.SIMPLE:
    distanceFromBoundary = TIER_BOUNDARIES.simpleMedium - weightedScore
else if mappedTier == Tier.REASONING:
    distanceFromBoundary = weightedScore - TIER_BOUNDARIES.complexReasoning
else:
    distanceFromBoundary = min(
     weightedScore - lowerBound,
        upperBound - weightedScore
    )
```

### 9.2 Apply Overrides and Minimums

After boundary mapping, apply the results from Phase 3:

```typescript
let finalTier: Tier;

// Step 1: Start with override tier or boundary-mapped tier
if (overrideTier !== null) {
  finalTier = overrideTier;
  reasoning += ` | boundary would map to ${mappedTier}, override forces ${overrideTier}`;
} else {
  finalTier = mappedTier;
  reasoning += ` | tier=${mappedTier}`;
}

// Step 2: Enforce structured output minimum tier
if (enforceStructuredMin && TIER_RANK[finalTier] < TIER_RANK[structuredOutputMinTier]) {
  reasoning += ` | upgraded from ${finalTier} to ${structuredOutputMinTier} (structured output)`;
  finalTier = structuredOutputMinTier;
}
```

### 9.3 Phase 4 Outputs

- `finalTier` (Tier) — the determined complexity tier
- `distanceFromBoundary` (number) — used for confidence calibration in Phase 5
- `reasoning` (string) — updated

---

## 10. Phase 5: Confidence Calibration and Ambiguity Handling

Phase 5 computes a confidence score that reflects how certain the classifier is about the tier assignment. The confidence is based on the distance from the nearest tier boundary — scores far from any boundary are high confidence; scores near a boundary are low confidence.

### 10.1 Sigmoid Calibration

```typescript
function calibrateConfidence(distance: number, steepness: number): number {
  return 1.0 / (1.0 + Math.exp(-steepness * distance));
}
```
**Parameters** (read from config — these are defaults):

```typescript
// Default values — override via config.confidenceSteepness
const CONFIDENCE_STEEPNESS: number = 12;
```

Higher steepness means the confidence transitions more sharply from low to high around the boundary — the "ambiguous zone" narrows. Lower steepness widens the zone, causing more requests to fall below the ambiguity threshold.

**Compute confidence**:

```typescript
let confidence = calibrateConfidence(distanceFromBoundary, CONFIDENCE_STEEPNESS);
```

**Apply override minimum**:

```typescript
if (overrideConfidence !== null) {
  confidence = Math.max(confidence, overrideConfidence);
}
```

### 10.2 Sigmoid Behavior

To illustrate how the sigmoid maps distance to confidence (with steepness = 12):

| Distance from boundary | Confidence |
|---|---|
| 0.00 | 0.500 |
| 0.02 | 0.562 |
| 0.05 | 0.646 |
| 0.08 | 0.722 |
| 0.10 | 0.769 |
| 0.15 | 0.858 |
| 0.20 | 0.917 |
| 0.30 | 0.973 |
| 0.50 | 0.998 |

Scores within 0.05 of a boundary produce confidence below 0.65 — these are the "ambiguous zone" cases.

### 10.3 Ambiguity Handling

Since this classifier makes no external calls, ambiguity is resolved with a deterministic default rather than an LLM fallback:

```typescript
// Default values — override via config.ambiguityThreshold and config.ambiguousDefaultTier
const AMBIGUITY_THRESHOLD: number = 0.55;
const AMBIGUOUS_DEFAULT_TIER: Tier = Tier.MEDIUM;
```

```
if confidence < AMBIGUITY_THRESHOLD:
    // The score is very close to a boundary.
    // Default to MEDIUM as a safe middle ground.
    reasoning += ` | low confidence (${confidence.toFixed(2)}) → default to ${AMBIGUOUS_DEFAULT_TIER}`
    finalTier = AMBIGUOUS_DEFAULT_TIER
    // Do NOT override confidence — report the actual low value so
    // downstream consumers can see the classifier was uncertain.
```

**Rationale for MEDIUM default**: MEDIUM is the safest default because:
- SIMPLE-tier models may fail on anything non-trivial.
- COMPLEX/REASONING-tier models are expensive for simple requests.
- MEDIUM provides a reasonable balance when the classifier is uncertain.

### 10.4 Final Result Assembly

```typescript
return {
  tier: finalTier,
  score: weightedScore,
  confidence: confidence,
  method: "rules",
  reasoning: reasoning,
  signals: signals,
  agenticScore: agenticScore,
  hasStructuredOutput: hasStructuredOutput,
};
```

This is the complete `ClassificationResult` output.

---

## 11. Keyword Lists

This section provides the complete keyword lists referenced by the dimension scorers in Phase 2. Each list is an array of strings. Matching is done via **case-insensitive substring search** against the prepared text (`fullText` or `userText` as specified per dimension).

**Matching algorithm**: For each keyword in a list, test whether the lowercased text contains the lowercased keyword as a substring. Count the number of distinct keywords that match (not the number of occurrences of each keyword). Example: if the keyword `"function"` appears 5 times in the text, it counts as 1 match.

```typescript
function countKeywordMatches(text: string, keywords: string[]): number {
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) {
    count++;
    }
  }
  return count;
}
```

### 11.1 CODE_KEYWORDS

Used by: Dimension 2 (`codePresence`).

```typescript
const CODE_KEYWORDS: string[] = [
  // English
  "function", "class", "import", "def", "SELECT", "async", "await",
  "const", "let", "var", "return", "```",
  // Chinese
  "函数", "类", "导入", "定义", "查询", "异步", "等待", "常量", "变量", "返回",
  // Japanese
  "関数", "クラス", "インポート", "非同期", "定数", "変数",
  // Russian
  "функция", "класс", "импорт", "определ", "запрос", "асинхронный",
  "ожидать", "константа", "переменная", "вернуть",
  // German
  "funktion", "klasse", "importieren", "definieren", "abfrage",
  "asynchron", "erwarten", "konstante", "zurückgeben",
];
```

### 11.2 REASONING_KEYWORDS

Used by: Dimension 3 (`reasoningMarkers`). Matched against `userText` only.

```typescript
const REASONING_KEYWORDS: string[] = [
  // English
  "prove", "theorem", "derive", "step by step", "chain of thought",
  "formally", "mathematical", "proof", "logically",
  // Chinese
  "证明", "定理", "推导", "逐步", "思维链", "形式化", "数学", "逻辑",
  // Japanese
  "証明", "定理", "導出", "ステップバイステップ", "論理的",
  // Russian
  "доказать", "докажи", "доказательств", "теорема", "вывести",
  "шаг за шагом", "пошагово", "поэтапно", "цепочка рассуждений",
  "рассуждени", "формально", "математически", "логически",
  // German
  "beweisen", "beweis", "ableiten", "schritt für schritt",
  "gedankenkette", "formal", "mathematisch", "logisch",
];
```

### 11.3 SIMPLE_KEYWORDS

Used by: Dimension 5 (`simpleIndicators`). These produce **negative** scores.

```typescript
const SIMPLE_KEYWORDS: string[] = [
  // English
  "what is", "define", "translate", "hello", "yes or no", "capital of",
  "how old", "who is", "when was",
  // Chinese
  "什么是", "定义", "翻译", "你好", "是否", "首都", "多大", "谁是", "何时",
  // Japanese
  "とは", "定義", "翻訳", "こんにちは", "はいかいいえ", "首都", "誰",
  // Russian
  "что такое", "определение", "перевести", "переведи", "привет",
  "да или нет", "столица", "сколько лет", "кто такой", "когда", "объясни",
  // German
  "was ist", "definiere", "übersetze", "hallo", "ja oder nein",
  "hauptstadt", "wie alt", "wer ist", "wann", "erkläre",
];
```

### 11.4 TECHNICAL_KEYWORDS

Used by: Dimension 6 (`technicalTerms`).

```typescript
const TECHNICAL_KEYWORDS: string[] = [
  // English
  "algorithm", "optimize", "architecture", "distributed", "kubernetes",
  "microservice", "database", "infrastructure",
  // Chinese
  "算法", "优化", "架构", "分布式", "微服务", "数据库", "基础设施",
  // Japanese
  "アルゴリズム", "最適化", "アーキテクチャ", "分散", "マイクロサービス",
  "データベース",
  // Russian
  "алгоритм", "оптимизировать", "оптимизаци", "оптимизируй", "архитектура",
  "распределённый", "микросервис", "база данных", "инфраструктура",
  // German
  "algorithmus", "optimieren", "architektur", "verteilt", "mikroservice",
  "datenbank", "infrastruktur",
];
```

### 11.5 CREATIVE_KEYWORDS

Used by: Dimension 10 (`creativeMarkers`).

```typescript
const CREATIVE_KEYWORDS: string[] = [
  // English
  "story", "poem", "compose", "brainstorm", "creative", "imagine", "write a",
  // Chinese
  "故事", "诗", "创作", "头脑风暴", "创意", "想象", "写一个",
  // Japanese
  "物語", "詩", "作曲", "ブレインストーム", "創造的", "想像",
  // Russian
  "история", "рассказ", "стихотворение", "сочинить", "сочини",
  "мозговой штурм", "творческий", "представить", "придумай", "напиши",
  // German
  "geschichte", "gedicht", "komponieren", "brainstorming", "kreativ",
  "vorstellen", "schreibe", "erzählung",
];
```
### 11.6 AGENTIC_KEYWORDS

Used by: Dimension 7 (`agenticTask`).

```typescript
const AGENTIC_KEYWORDS: string[] = [
  // English — File/resource operations
  "read file", "read the file", "look at", "check the", "open the",
  "edit", "modify", "update the", "change the", "write to", "create file",
  // English — Execution commands
  "execute", "deploy", "install", "npm", "pip", "compile",
  // English — Multi-step agentic patterns
  "after that", "and also", "once done", "step 1", "step 2",
  // English — Iterative work
  "fix", "debug", "until it works", "keep trying", "iterate",
  "make sure", "verify", "confirm",
  // Chinese
  "读取文件", "查看", "打开", "编辑", "修改", "更新", "创建",
  "执行", "部署", "安装", "第一步", "第二步", "修复", "调试",
  "直到", "确认", "验证",
];
```

### 11.7 IMPERATIVE_KEYWORDS

Used by: Dimension 14 (`imperativeVerbs`).

```typescript
const IMPERATIVE_KEYWORDS: string[] = [
  // English
  "build", "create", "implement", "design", "develop", "construct",
  "generate", "deploy", "configure", "set up",
  // Chinese
  "构建", "创建", "实现", "设计", "开发", "生成", "部署", "配置", "设置",
  // Japanese
  "構築", "作成", "実装", "設計", "開発", "生成", "デプロイ", "設定",
  // Russian
  "построить", "построй", "создать", "создай", "реализовать", "реализуй",
  "спроектировать", "разработать", "разработай", "сконструировать",
  "сгенерировать", "сгенерируй", "развернуть", "разверни", "настроить", "настрой",
  // German
  "erstellen", "bauen", "implementieren", "entwerfen", "entwickeln",
  "konstruieren", "generieren", "bereitstellen", "konfigurieren", "einrichten",
];
```

### 11.8 CONSTRAINT_KEYWORDS

Used by: Dimension 11 (`constraintCount`).

```typescript
const CONSTRAINT_KEYWORDS: string[] = [
  // English
  "under", "at most", "at least", "within", "no more than", "o(",
  "maximum", "minimum", "limit", "budget",
  // Chinese
  "不超过", "至少", "最多", "在内", "最大", "最小", "限制", "预算",
  // Japanese
  "以下", "最大", "最小", "制限", "予算",
  // Russian
  "не более", "не менее", "как минимум", "в пределах",
  "максимум", "минимум", "ограничение", "бюджет",
  // German
  "höchstens", "mindestens", "innerhalb", "nicht mehr als",
  "maximal", "minimal", "grenze", "budget",
];
```

### 11.9 OUTPUT_FORMAT_KEYWORDS

Used by: Dimension 12 (`outputFormat`).
```typescript
const OUTPUT_FORMAT_KEYWORDS: string[] = [
  // English
  "json", "yaml", "xml", "table", "csv", "markdown", "schema",
  "format as", "structured",
  // Chinese
  "表格", "格式化为", "结构化",
  // Japanese
  "テーブル", "フォーマット", "構造化",
  // Russian
  "таблица", "форматировать как", "структурированный",
  // German
  "tabelle", "formatieren als", "strukturiert",
];
```

### 11.10 REFERENCE_KEYWORDS

Used by: Dimension 15 (`referenceComplexity`).

```typescript
const REFERENCE_KEYWORDS: string[] = [
  // English
  "above", "below", "previous", "following", "the docs", "the api",
  "the code", "earlier", "attached",
  // Chinese
  "上面", "下面", "之前", "接下来", "文档", "代码", "附件",
  // Japanese
  "上記", "下記", "前の", "次の", "ドキュメント", "コード",
  // Russian
  "выше", "ниже", "предыдущий", "следующий", "документация", "код",
  "ранее", "вложение",
  // German
  "oben", "unten", "vorherige", "folgende", "dokumentation",
  "der code", "früher", "anhang",
];
```

### 11.11 NEGATION_KEYWORDS

Used by: Dimension 16 (`negationComplexity`).

```typescript
const NEGATION_KEYWORDS: string[] = [
  // English
  "don't", "do not", "avoid", "never", "without", "except",
  "exclude", "no longer",
  // Chinese
  "不要", "避免", "从不", "没有", "除了", "排除",
  // Japanese
  "しないで", "避ける", "決して", "なしで", "除く",
  // Russian
  "не делай", "не надо", "нельзя", "избегать", "никогда", "без",
  "кроме", "исключить", "больше не",
  // German
  "nicht", "vermeide", "niemals", "ohne", "außer",
  "ausschließen", "nicht mehr",
];
```

---

## 12. Default Configuration Reference

All tunable parameters in one place. The implementer must define these as the **default** configuration object. Every value below can be overridden at runtime by the caller (see Section 14.2 for the configuration mechanism). The values shown here are recommended starting points based on analysis of four open-source routing projects; operators should tune them to their specific workload.

### 12.1 ClassifierConfig Type

```typescript
interface ClassifierConfig {
  maxTokensForceComplex: number;

  dimensionWeights: Record<string, number>;

  reasoningOverrideMinMatches: number;
  reasoningOverrideMinConfidence: number;
  reasoningOverrideMinScore: number;
  architectureOverrideConfidence: number;
  architectureOverrideMinScore: number;
  structuredOutputMinTier: Tier;

  tierBoundaries: {
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };

  confidenceSteepness: number;
  ambiguityThreshold: number;
  ambiguousDefaultTier: Tier;

  keywords: {
    code: string[];
    reasoning: string[];
    simple: string[];
    technical: string[];
    creative: string[];
    agentic: string[];
    imperative: string[];
    constraint: string[];
    outputFormat: string[];
    reference: string[];
    negation: string[];
  };
}
```

### 12.2 Default Values

```typescript
const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  // --- Phase 1: Short-circuit thresholds ---
  maxTokensForceComplex: 100_000,

  // --- Phase 2: Dimension weights (must sum to 1.00) ---
  dimensionWeights: {
    tokenCount:          0.08,
    codePresence:        0.14,
    reasoningMarkers:    0.18,
    multiStepPatterns:   0.12,
    simpleIndicators:    0.10,
    technicalTerms:      0.08,
    agenticTask:         0.06,
    toolPresence:    0.05,
    questionComplexity:  0.04,
    creativeMarkers:     0.03,
    constraintCount:     0.03,
    outputFormat:        0.03,
    conversationDepth:   0.02,
    imperativeVerbs:     0.02,
    referenceComplexity: 0.01,
    negationComplexity:  0.01,
  },

  // --- Phase 3: Override parameters ---
  reasoningOverrideMinMatches: 2,     // minimum reasoning keyword matches to force REASONING
  reasoningOverrideMinConfidence: 0.85,
  reasoningOverrideMinScore: 0.42,
  architectureOverrideConfidence: 0.82,
  architectureOverrideMinScore: 0.22,
  structuredOutputMinTier: "MEDIUM" as Tier,

  // --- Phase 4: Tier boundary thresholds ---
  tierBoundaries: {
    simpleMedium:    0.00,
    mediumComplex:     0.20,
    complexReasoning:  0.40,
  },

  // --- Phase 5: Confidence calibration ---
  confidenceSteepness: 12,
  ambiguityThreshold: 0.55,
  ambiguousDefaultTier: "MEDIUM" as Tier,

  // --- Keyword lists (references to arrays from Section 11) ---
  keywords: {
    code:     CODE_KEYWORDS,
    reasoning:       REASONING_KEYWORDS,
    simple:    SIMPLE_KEYWORDS,
    technical:       TECHNICAL_KEYWORDS,
    creative:        CREATIVE_KEYWORDS,
    agentic:      AGENTIC_KEYWORDS,
    imperative:      IMPERATIVE_KEYWORDS,
    constraint:      CONSTRAINT_KEYWORDS,
    outputFormat:    OUTPUT_FORMAT_KEYWORDS,
    reference:     REFERENCE_KEYWORDS,
    negation:        NEGATION_KEYWORDS,
  },
};
```

---

## 13. Worked Examples

These examples trace through the full pipeline to demonstrate expected behavior. They serve as acceptance tests for an implementation.

### 13.1 Example: Heartbeat

**Input**:
```json
{
  "messages": [{ "role": "user", "content": "ping" }]
}
```

**Phase 1**: `lastUserMessage = "ping"`. Matches `HEARTBEAT_PATTERNS[0]`: `/^(ping|pong|status|alive|check|heartbeat|noop|ack)[\s?!.]*$/i`.

**Result**:
```json
{
  "tier": "HEARTBEAT",
  "score": -1.0,
  "confidence": 0.95,
  "method": "short-circuit",
  "reasoning": "heartbeat: matched trivial pattern",
  "signals": ["heartbeat-pattern"],
  "agenticScore": 0.0,
  "hasStructuredOutput": false
}
```

Phases 2–5 are **not executed**.

---

### 13.2 Example: Simple Factual Question

**Input**:
```json
{
  "messages": [{ "role": "user", "content": "What is the capital of France?" }]
}
```

**Phase 1**: No heartbeat match (too long and not a trivial pattern). No forced tier. `estimatedTokens ≈ 9`. Not above 100k. Proceed.

**Phase 2 dimension scoring** (key dimensions):

| Dimension | Match detail | Score |
|---|---|---|
| `tokenCount` | 9 tokens < 50 | -0.5 |
| `simpleIndicators` | "what is", "capital of" → 2 matches | -0.5 |
| `questionComplexity` | 1 question mark → single question | -0.3 |
| All others | No matches | 0.0 |

**Weighted score**:
```
= (0.08 × -0.5)   tokenCount
+ (0.10 × -0.5)    simpleIndicators
+ (0.04 × -0.3)  questionComplexity
+ 0 (all others)
= -0.040 - 0.050 - 0.012
= -0.102
```

**Phase 3**: No overrides fire (reasoningMatches = 0, no architecture signal, no structured output).

**Phase 4**: `weightedScore = -0.102 < 0.00 (simpleMedium boundary)` → `mappedTier = SIMPLE`.
`distanceFromBoundary = 0.00 - (-0.102) = 0.102`.

**Phase 5**: `confidence = 1 / (1 + exp(-12 × 0.102)) = 1 / (1 + exp(-1.224)) ≈ 1 / (1 + 0.294) ≈ 0.773`.
Confidence 0.773 > 0.55 threshold → no ambiguity default.

**Result**:
```json
{
  "tier": "SIMPLE",
  "score": -0.102,
  "confidence": 0.773,
  "method": "rules",
  "reasoning": "rules: score=-0.102 | tier=SIMPLE",
  "signals": ["tokens:very-short", "simple-indicators:2", "questions:single"],
  "agenticScore": 0.0,
  "hasStructuredOutput": false
}
```

---

### 13.3 Example: Code Generation Request

**Input**:
```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful coding assistant." },
    { "role": "user", "content": "Write a Python function that implements binary search on a sorted array. Include type hints and handle edge cases." }
  ]
}
```

**Phase 1**: No heartbeat. No forced tier. `estimatedTokens ≈ 35`. Not above 100k. Proceed.

**Phase 2 dimension scoring** (key dimensions):

| Dimension | Match detail | Score |
|---|---|---|
| `tokenCount` | 35 tokens < 50 | -0.5 |
| `codePresence` | "function", "import" (from "implement") → partial. Actually "function" matches. 1 match | 0.5 |
| `technicalTerms` | "algorithm" (from "binary search" — no direct match), let's check: no exact keyword match. 0 matches | 0.0 |
| `imperativeVerbs` | "implement" → 1 match | 0.3 |
| `constraintCount` | "edge cases" → no exact keyword match. 0 matches | 0.0 |
| `creativeMarkers` | "write a" → 1 match | 0.3 |
| All others | 0 | 0.0 |

**Weighted score**:
```
= (0.08 × -0.5)   tokenCount
+ (0.14 × 0.5)    codePresence
+ (0.02 × 0.3)    imperativeVerbs
+ (0.03 × 0.3)    creativeMarkers
= -0.040 + 0.070 + 0.006 + 0.009
= 0.045
```

**Phase 3**: No overrides fire.

**Phase 4**: `0.00 ≤ 0.045 < 0.20` → `mappedTier = MEDIUM`.
`distanceFromBoundary = min(0.045 - 0.00, 0.20 - 0.045) = min(0.045, 0.155) = 0.045`.

**Phase 5**: `confidence = 1 / (1 + exp(-12 × 0.045)) = 1 / (1 + exp(-0.54)) ≈ 1 / (1 + 0.583) ≈ 0.632`.
Confidence 0.632 > 0.55 → no ambiguity default.

**Result**:
```json
{
  "tier": "MEDIUM",
  "score": 0.045,
  "confidence": 0.632,
  "method": "rules",
  "reasoning": "rules: score=0.045 | tier=MEDIUM",
  "signals": ["tokens:very-short", "code-keywords:1", "imperative-verbs:1", "creative-markers:1"],
  "agenticScore": 0.0,
  "hasStructuredOutput": false
}
```

Note: The relatively low confidence (0.632) reflects that this is near the SIMPLE/MEDIUM boundary. If the prompt were longer or contained code blocks, more code keywords, or multi-step patterns, it would score higher and classify as COMPLEX.

---

### 13.4 Example: Reasoning Task

**Input**:
```json
{
  "messages": [
    { "role": "user", "content": "Prove that the square root of 2 is irrational. Derive the proof step by step using proof by contradiction." }
  ]
}
```

**Phase 1**: No heartbeat. No forced tier. `estimatedTokens ≈ 23`. Proceed.

**Phase 2 dimension scoring** (key dimensions):

| Dimension | Match detail | Score |
|---|---|---|
| `tokenCount` | 23 < 50 | -0.5 |
| `reasoningMarkers` (userText only) | "prove", "proof", "derive", "step by step" → 4 matches | 1.0 |
| `multiStepPatterns` | "step by step" doesn't match numbered step patterns directly, but no numbered steps. 0 matches | 0.0 |
| `technicalTerms` | 0 matches | 0.0 |
| All others | 0 | 0.0 |

**Weighted score**:
```
= (0.08 × -0.5) + (0.18 × 1.0)
= -0.040 + 0.180
= 0.140
```

**Phase 3 — Override 1 fires**: `reasoningMatches = 4 ≥ 2`.
- `overrideTier = REASONING`
- `weightedScore = max(0.140, 0.42) = 0.42`
- `overrideConfidence = 0.85`

**Phase 4**: With adjusted `weightedScore = 0.42 ≥ 0.40 (complexReasoning)` → `mappedTier = REASONING`.
`distanceFromBoundary = 0.42 - 0.40 = 0.02`.
`overrideTier = REASONING` matches `mappedTier`, so `finalTier = REASONING`.

**Phase 5**: `confidence = 1 / (1 + exp(-12 × 0.02)) = 1 / (1 + exp(-0.24)) ≈ 0.560`.
But `overrideConfidence = 0.85`, so `confidence = max(0.560, 0.85) = 0.85`.

**Result**:
```json
{
  "tier": "REASONING",
  "score": 0.42,
  "confidence": 0.85,
  "method": "rules",
  "reasoning": "rules: score=0.420 | override: 2+ reasoning markers → REASONING | tier=REASONING",
  "signals": ["tokens:very-short", "reasoning-markers:4"],
  "agenticScore": 0.0,
  "hasStructuredOutput": false
}
```

---

### 13.5 Example: Agentic Task with Tools

**Input**:
```json
{
  "messages": [
  { "role": "user", "content": "Read the file config.json, check the database settings, then update the connection string and verify it works." }
  ],
  "tools": [
    { "type": "function", "function": { "name": "read_file", "description": "Read a file" } },
    { "type": "function", "function": { "name": "write_file", "description": "Write a file" } }
  ],
  "tool_choice": "auto"
}
```
**Phase 1**: No heartbeat. No forced tier. `estimatedTokens ≈ 28`. Proceed.

**Phase 2 dimension scoring** (key dimensions):

| Dimension | Match detail | Score |
|---|---|---|
| `tokenCount` | 28 < 50 | -0.5 |
| `agenticTask` | "read file" (partial: "read the file"), "check the", "update the", "verify" → 4 matches | 1.0 (agenticScore=1.0) |
| `toolPresence` | hasTools=true, hasExplicitToolChoice=false (tool_choice="auto" is not explicit) | 0.6 |
| `multiStepPatterns` | "then" present in "check...then update": matches `/first\s*[,.]?\s*then/i`? No "first" keyword. But "then" and "verify" → no exact pattern match. 0 | 0.0 |
| `technicalTerms` | "database" → 1 match | 0.3 |
| `imperativeVerbs` | "create" no, but none of the exact imperative keywords match here | 0.0 |
| All others | 0 | 0.0 |

After toolPresence fires: `agenticScore` was already 1.0 from dimension 7, so the side-effect in dimension 8 (set to 0.3 if agenticScore was 0.0) does not apply.

**Weighted score**:
```
= (0.08 × -0.5) + (0.06 × 1.0) + (0.05 × 0.6) + (0.08 × 0.3)
= -0.040 + 0.060 + 0.030 + 0.024
= 0.074
```

**Phase 3**: No reasoning override (0 reasoning matches). No architecture signal. No structured output.

**Phase 4**: `0.00 ≤ 0.074 < 0.20` → `mappedTier = MEDIUM`.
`distanceFromBoundary = min(0.074, 0.126) = 0.074`.

**Phase 5**: `confidence = 1 / (1 + exp(-12 × 0.074)) ≈ 1 / (1 + exp(-0.888)) ≈ 1 / 1.411 ≈ 0.709`.
**Result**:
```json
{
  "tier": "MEDIUM",
  "score": 0.074,
  "confidence": 0.709,
  "method": "rules",
  "reasoning": "rules: score=0.074 | tier=MEDIUM",
  "signals": ["tokens:very-short", "agentic-task:4", "tools-present", "technical-terms:1"],
  "agenticScore": 1.0,
  "hasStructuredOutput": false
}
```

Note: The tier is MEDIUM (moderate cognitive complexity), but `agenticScore = 1.0` signals that this is a heavily agentic request. Downstream routing can use `agenticScore` to select agentic-optimized models even though the cognitive tier is only MEDIUM.

---

### 13.6 Example: Ambiguous Request Near Boundary

**Input**:
```json
{
  "messages": [
    { "role": "user", "content": "Compare these two approaches for caching." }
  ]
}
```

**Phase 1**: No short-circuit. `estimatedTokens ≈ 10`. Proceed.

**Phase 2** (key dimensions):

| Dimension | Match detail | Score |
|---|---|---|
| `tokenCount` | 10 < 50 | -0.5 |
| `simpleIndicators` | "what is" no, "define" no, etc → 0 | 0.0 |
| `technicalTerms` | "caching" is not in the list. 0 | 0.0 |
| `questionComplexity` | 0 question marks | 0.0 |
| All others | 0 | 0.0 |

**Weighted score**:
```
= (0.08 × -0.5)
= -0.040
```

**Phase 4**: `-0.040 < 0.00` → `mappedTier = SIMPLE`.
`distanceFromBoundary = 0.00 - (-0.040) = 0.040`.

**Phase 5**: `confidence = 1 / (1 + exp(-12 × 0.040)) = 1 / (1 + exp(-0.48)) ≈ 1 / 1.619 ≈ 0.618`.
Confidence 0.618 > 0.55 → no ambiguity default.

**Result**:
```json
{
  "tier": "SIMPLE",
  "score": -0.040,
  "confidence": 0.618,
  "method": "rules",
  "reasoning": "rules: score=-0.040 | tier=SIMPLE",
  "signals": ["tokens:very-short"],
  "agenticScore": 0.0,
  "hasStructuredOutput": false
}
```

This is a borderline case — the low confidence (0.618) reflects proximity to the SIMPLE/MEDIUM boundary. If this were `0.04` higher (e.g., if one technical term matched), it would cross into MEDIUM.

---

### 13.7 Example: Structured Output Enforcement

**Input**:
```json
{
  "messages": [{ "role": "user", "content": "What is 2+2?" }],
  "response_format": { "type": "json_object" }
}
```

**Phase 2**: `tokenCount` = ~3 → score -0.5. `simpleIndicators`: "what is" → 1 match → -0.5. `outputFormat`: `response_format.type = "json_object"` (not "text") → formatFromApi=true → score 0.8, `hasStructuredOutput = true`. `questionComplexity`: 1 question → -0.3.

**Weighted score**:
```
= (0.08 × -0.5) + (0.10 × -0.5) + (0.03 × 0.8) + (0.04 × -0.3)
= -0.040 - 0.050 + 0.024 - 0.012
= -0.078
```

**Phase 3**: Override 3 fires: `enforceStructuredMin = true`.

**Phase 4**: `-0.078 < 0.00` → `mappedTier = SIMPLE`. But `enforceStructuredMin` is true and `TIER_RANK[SIMPLE] (1) < TIER_RANK[MEDIUM] (2)`, so `finalTier = MEDIUM`.

**Result**:
```json
{
  "tier": "MEDIUM",
  "score": -0.078,
  "confidence": 0.654,
  "method": "rules",
  "reasoning": "rules: score=-0.078 | tier=SIMPLE | upgraded from SIMPLE to MEDIUM (structured output)",
  "signals": ["tokens:very-short", "simple-indicators:1", "output-format:api-response-format", "questions:single"],
  "agenticScore": 0.0,
  "hasStructuredOutput": true
}
```

---

## 14. Implementation Notes

### 14.1 Function Signature

The classifier should be implemented as a single synchronous function:

```typescript
function classify(input: ClassifierInput, config?: ClassifierConfig): ClassificationResult
```

The `config` parameter is optional. When omitted, the classifier uses the default configuration defined in Section 12. When provided, it overrides the defaults. This allows callers to tune every aspect of scoring behavior without modifying source code.

It must be synchronous (no `async`) because it makes no external calls and should execute in < 1ms.

### 14.2 Configuration Requirements

**All scoring cutoffs, dimension weights, tier boundaries, override thresholds, confidence parameters, and keyword lists must be configurable at runtime via the `ClassifierConfig` object.** The values documented throughout this specification (in Sections 7–10 and Section 12) are **defaults**, not constants. An operator must be able to override any of them.

The configuration object must support at minimum:

1. **Dimension weights** (`dimensionWeights`): The weight assigned to each of the 16 dimensions. Weights do not need to sum to 1.0 — the classifier should work correctly with any non-negative weights. However, the default weights sum to 1.0 and this is the recommended convention.

2. **Tier boundary thresholds** (`tierBoundaries`): The `simpleMedium`, `mediumComplex`, and `complexReasoning` cutoff values that map weighted scores to tiers. Adjusting these shifts where tier transitions occur.

3. **Per-dimension scoring thresholds**: Each dimension's internal cutoffs (e.g., the token count thresholds of 50/200/500/2000, the keyword match thresholds of low/high, the score values returned at each level). These control how aggressively each dimension contributes to the overall score.

4. **Override parameters**: The reasoning override minimum match count (`reasoningOverrideMinMatches`), minimum confidence (`reasoningOverrideMinConfidence`), architecture override confidence, and structured output minimum tier.

5. **Confidence calibration parameters**: The sigmoid `steepness` value and the `ambiguityThreshold` below which the classifier defaults to the `ambiguousDefaultTier`.

6. **Short-circuit thresholds**: The `maxTokensForceComplex` token count threshold and heartbeat patterns.

7. **Keyword lists**: All 11 keyword arrays. Operators may need to add domain-specific keywords, remove keywords that cause false positives in their workload, or add keywords in additional languages.

The implementation should merge a partial user-provided config with the defaults using a deep merge, so that an operator can override only the fields they care about:

```typescript
// Example: operator overrides only the tier boundaries and one weight
const customConfig: Partial<ClassifierConfig> = {
  tierBoundaries: {
    simpleMedium: -0.05,
    mediumComplex: 0.25,
    complexReasoning: 0.45,
  },
  dimensionWeights: {
    ...DEFAULT_CLASSIFIER_CONFIG.dimensionWeights,
    codePresence: 0.20,   // increase code influence
  },
};

const result = classify(input, customConfig);
```

### 14.3 Module Structure

Recommended file organization:

```
classifier/
  index.ts          — exports the classify() function
  types.ts          — Tier enum, ClassifierInput, ClassificationResult,
                      DimensionScore, ClassifierConfig
  config.ts         — DEFAULT_CLASSIFIER_CONFIG object, all default keyword
       arrays, deep-merge utility for user overrides
  phase1.ts         — heartbeat detection, forced tier, token overflow
  dimensions.ts     — all 16 dimension scorer functions
  scoring.ts        — weighted sum, override checks, boundary mapping, confidence
```

Each dimension scorer should be a standalone pure function that receives its relevant configuration slice (thresholds, keyword list) as a parameter rather than importing globals. This makes unit testing straightforward — test each dimension in isolation with different config values, then test the integration.

### 14.3 Testing Strategy

The implementation must include tests covering:

1. **Heartbeat patterns**: All six regex patterns, plus the short-message fallback. Verify that heartbeat does NOT match when tools are present.
2. **Forced tier directive**: Each tier name. Verify case-insensitive matching.
3. **Token overflow**: Exactly at threshold (should not trigger), one above threshold (should trigger).
4. **Each dimension in isolation**: For every dimension, test with 0 matches, low match count, and high match count. Verify scores match the specified values.
5. **Negative scoring**: Verify that a request with only `simpleIndicators` matches produces a negative weighted score that maps to SIMPLE.
6. **Reasoning override**: 0 reasoning matches (no override), 1 match (no override), 2 matches (override fires).
7. **Architecture override**: Test with architecture noun only (no override), design verb only (no override), both (override fires).
8. **Structured output minimum tier**: SIMPLE request with `response_format: { type: "json_object" }` must result in MEDIUM.
9. **Ambiguity handling**: Construct a score that falls within 0.02 of a boundary. Verify low confidence. Construct a score within the ambiguity threshold range (confidence < 0.55) and verify default to MEDIUM.
10. **Agentic score independence**: A request with tools and agentic keywords but simple cognitive content should produce a low tier (SIMPLE or MEDIUM) with a high `agenticScore`.
11. **The six worked examples from Section 13**: Each must produce the documented tier, score (within ±0.01), and signals.

### 14.4 Performance Requirements

- The classifier must execute in **< 1ms** on a single CPU core for typical requests (< 10,000 characters).
- Keyword matching is O(n × k) where n = text length, k = total keywords across all lists. With ~300 keywords and typical text lengths, this is well under 1ms.
- No allocations per keyword match are needed — use `string.includes()` or equivalent.
- Precompile all regexes at module load time, not per invocation.

### 14.5 Edge Cases

- **Empty messages array**: If no user message is found, `lastUserMessage = ""`. This will match the heartbeat pattern `/^[.!?\s]*$/` (empty string). Return HEARTBEAT.
- **Multimodal content**: If user messages contain image parts, the text parts are concatenated for analysis. Image presence alone does not affect classification (images are not inspected).
- **Very long keyword lists**: If keyword lists are extended significantly (> 1000 keywords), consider building a trie or set for O(1) lookup per keyword. The current lists (~300 entries) do not require this optimization.
- **Non-Latin scripts**: All keyword matching is substring-based on lowercased text. The keyword lists include Chinese, Japanese, Russian, and German entries. No special tokenization is needed for CJK — substring matching works correctly for these scripts.
- **Tool calls in assistant messages**: If prior assistant messages contain `tool_calls`, this does not affect classification. Only the `tools` field (declared tool schemas) and `tool_choice` on the request itself are used.
