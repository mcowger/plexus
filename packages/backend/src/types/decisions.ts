import { z } from 'zod';

/**
 * Shared Jev-style Decisions contract.
 *
 * All upstreams serve TypeSafe's System One protocol at `/systemone` —
 * TypeSafe directly and OpenRouter at `/api/v1/systemone` (bare model ids
 * map onto the `typesafe/` namespace). Plexus therefore exposes a single
 * `systemone` target: `{model, state, questions}` with one typed answer
 * returned per question id.
 *
 * Limits below mirror the upstream docs, using the intersection both
 * upstreams accept: score levels 2-10, at most 255 choice options.
 */

export const MAX_DECISIONS_CHOICE_OPTIONS = 255;
export const MIN_DECISIONS_SCORE_LEVELS = 2;
export const MAX_DECISIONS_SCORE_LEVELS = 10;

/** Target protocol able to serve an incoming `decisions` request. */
export const SYSTEMONE_API_TYPE = 'systemone';
export const SYSTEMONE_ENDPOINT = '/systemone';
/** @deprecated Use SYSTEMONE_API_TYPE. Normalized onto it at load time; kept for reads. */
export const OPENROUTER_DECISIONS_API_TYPE = 'openrouter-decisions';
/** @deprecated Use SYSTEMONE_API_TYPE. Normalized onto it at load time; kept for reads. */
export const TYPESAFE_DECISIONS_API_TYPE = 'typesafe-decisions';

/** Structured guidance: a plain string, or a JSON object/array of context. */
export const DecisionsStructuredSchema = z.union([
  z.string(),
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);
export type DecisionsStructured = z.infer<typeof DecisionsStructuredSchema>;

const DecisionsNoulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: DecisionsStructuredSchema,
  // Optional on both upstreams. When present, both sides are required —
  // never synthesize a missing side.
  criteria: z
    .object({ true: DecisionsStructuredSchema, false: DecisionsStructuredSchema })
    .optional(),
});

const DecisionsChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: DecisionsStructuredSchema,
  criteria: z
    .record(z.string(), z.union([DecisionsStructuredSchema, z.null()]))
    .refine((criteria) => Object.keys(criteria).length >= 1, {
      message: 'choice criteria must define at least one option',
    })
    .refine((criteria) => Object.keys(criteria).length <= MAX_DECISIONS_CHOICE_OPTIONS, {
      message: `choice criteria must define at most ${MAX_DECISIONS_CHOICE_OPTIONS} options`,
    }),
});

const DecisionsScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: DecisionsStructuredSchema,
  criteria: z
    .array(DecisionsStructuredSchema)
    .min(
      MIN_DECISIONS_SCORE_LEVELS,
      `score criteria must define at least ${MIN_DECISIONS_SCORE_LEVELS} levels`
    )
    .max(
      MAX_DECISIONS_SCORE_LEVELS,
      `score criteria must define at most ${MAX_DECISIONS_SCORE_LEVELS} levels`
    ),
});

export const DecisionsQuestionSchema = z.discriminatedUnion('type', [
  DecisionsNoulQuestionSchema,
  DecisionsChoiceQuestionSchema,
  DecisionsScoreQuestionSchema,
]);
export type DecisionsQuestion = z.infer<typeof DecisionsQuestionSchema>;

/**
 * Ingress validator for POST /v1/decisions.
 *
 * Accepts `{model, state, questions}` only. `stream` is explicitly rejected —
 * Decisions is a buffered API and stripping the flag would silently change
 * request semantics.
 *
 * Breaking change: the OpenRouter-only routing/observability fields
 * (`provider`, `session_id`, `trace`, `user`) were removed when both
 * upstreams converged on the System One protocol. Unknown keys are stripped,
 * so clients still sending them get a 200 with those settings ignored —
 * remove them from client code.
 */
export const DecisionsIngressSchema = z.object({
  model: z.string().trim().min(1, 'model must be a non-empty string'),
  state: z.union([z.string(), z.record(z.string(), z.any()), z.array(z.any())]),
  questions: z
    .record(z.string(), DecisionsQuestionSchema)
    .refine((questions) => Object.keys(questions).length >= 1, {
      message: 'questions must define at least one question',
    }),
  // Declared (rather than caught in superRefine) because unknown keys are
  // stripped before superRefine runs. Decisions is buffered-only; silently
  // dropping the flag would change request semantics.
  stream: z
    .any()
    .refine((value) => value === undefined, {
      message: 'streaming is not supported for decisions requests',
    })
    .optional(),
});
export type DecisionsIngress = z.infer<typeof DecisionsIngressSchema>;

// --- Upstream response boundary -------------------------------------------

const DecisionsNoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number(),
});

const DecisionsChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

const DecisionsScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  legend: z.record(z.string(), DecisionsStructuredSchema).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

const DecisionsAnswerSchema = z.discriminatedUnion('type', [
  DecisionsNoulAnswerSchema,
  DecisionsChoiceAnswerSchema,
  DecisionsScoreAnswerSchema,
]);
export type DecisionsAnswer = z.infer<typeof DecisionsAnswerSchema>;

/**
 * Minimum usable core of an upstream Decisions response. Optional extras
 * (`id`, `provider`, `usage.cost`) are preserved from the raw body rather
 * than the parsed shape so no valid upstream field is dropped.
 */
const DecisionsUpstreamCoreSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), DecisionsAnswerSchema),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cost: z.number().optional(),
  }),
});

export interface DecisionsUpstreamResponse {
  model: string;
  answers: Record<string, DecisionsAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
  id?: string;
  provider?: string;
}

function decisionsUpstreamError(message: string): Error {
  const error = new Error(message) as Error & { routingContext?: Record<string, unknown> };
  error.routingContext = { statusCode: 502, code: 'provider_response_error' };
  return error;
}

/** Validates the core of an upstream Decisions payload; throws 502 when unusable. */
export function parseDecisionsUpstreamResponse(body: unknown): DecisionsUpstreamResponse {
  const parsed = DecisionsUpstreamCoreSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data.answers).length === 0) {
    throw decisionsUpstreamError(
      `Upstream returned an unusable Decisions response: ${
        parsed.success ? 'empty answers map' : (parsed.error.issues[0]?.message ?? 'invalid shape')
      }`
    );
  }
  const raw = body as Record<string, any>;
  const response: DecisionsUpstreamResponse = {
    model: parsed.data.model,
    answers: parsed.data.answers,
    usage: {
      input_tokens: parsed.data.usage.input_tokens,
      output_tokens: parsed.data.usage.output_tokens,
      ...(parsed.data.usage.cost !== undefined ? { cost: parsed.data.usage.cost } : {}),
    },
  };
  if (typeof raw.id === 'string') response.id = raw.id;
  if (typeof raw.provider === 'string') response.provider = raw.provider;
  return response;
}
