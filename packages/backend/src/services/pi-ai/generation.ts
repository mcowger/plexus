/**
 * Generalized generation intent for pi-ai registry compatibility.
 *
 * This is the carrier the inbound parsers populate and the executor threads
 * into the capability-aware egress builder. It supersedes the ad-hoc
 * `streamOptions` fragment (which only ever carried `temperature` + `maxTokens`)
 * and the standalone `reasoningIntent`.
 *
 * The design mirrors the reasoning work: every protocol expresses these knobs
 * differently, so each parser normalizes its dialect into ONE canonical
 * {@link GenerationIntent}; the egress side (`registry.ts`) then re-expands
 * the intent against the resolved pi-ai model's capabilities.
 *
 * Fields here are deliberately raw client intent — clamping to model limits,
 * incompatibility guards (e.g. temperature vs. thinking), and per-provider
 * field naming all happen at egress, never at ingress.
 */

import type { ReasoningIntent } from './reasoning';

/** Verbosity vocabulary (OpenAI `text.verbosity`). */
export type TextVerbosity = 'low' | 'medium' | 'high';

export interface GenerationIntent {
  /** Reasoning/thinking intent (effort, budget, enabled, visibility). */
  reasoning: ReasoningIntent;
  /** Requested max output tokens (clamped to model.maxTokens at egress). */
  maxTokens?: number;
  /** Sampling temperature (dropped at egress when incompatible with thinking). */
  temperature?: number;
  /** Output verbosity (OpenAI-family only at egress). */
  verbosity?: TextVerbosity;
  /** Service tier (openai-family / responses), e.g. "auto" | "flex" | "priority". */
  serviceTier?: string;
}

/** Normalize a client verbosity string to our vocabulary. */
export function normalizeVerbosity(raw: unknown): TextVerbosity | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return undefined;
}
