export enum Tier {
  HEARTBEAT = 'HEARTBEAT',
  SIMPLE = 'SIMPLE',
  MEDIUM = 'MEDIUM',
  COMPLEX = 'COMPLEX',
  REASONING = 'REASONING',
}

export const TIER_RANK: Record<Tier, number> = {
  HEARTBEAT: 0,
  SIMPLE: 1,
  MEDIUM: 2,
  COMPLEX: 3,
  REASONING: 4,
};

export interface ClassifierInput {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null | Array<{ type: string; text?: string }>;
    tool_calls?: Array<{
      function: { name: string; arguments: string };
    }>;
  }>;
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: object };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: string } | undefined;
  max_tokens?: number;
}

export interface DimensionScore {
  name: string;
  score: number;
  signal: string | null;
}

export interface ClassificationResult {
  tier: Tier;
  score: number;
  confidence: number;
  method: 'short-circuit' | 'rules';
  reasoning: string;
  signals: string[];
  agenticScore: number;
  hasStructuredOutput: boolean;
}

export interface ClassifierConfig {
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
