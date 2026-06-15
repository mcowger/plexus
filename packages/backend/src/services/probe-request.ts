/**
 * Canonical probe request shape used by both the management test endpoint
 * and the background explorer.
 *
 * The shape is intentionally fixed and version-stamped. Any future change
 * to the prompts, tools, or generation parameters must bump
 * PROBE_SHAPE_VERSION so historical performance data can be invalidated if
 * the new shape is no longer comparable.
 *
 * Design constraints:
 *  - Moderate input (a few hundred tokens) so TTFT is not dominated by a
 *    trivially short prompt.
 *  - Two stub tool definitions so the tool-handling code path on the
 *    provider side is exercised.
 *  - max_tokens large enough (1000) that responses are not artificially
 *    length-limited; TPS reflects realistic generation throughput.
 *  - stream: true to match the predominant live-traffic pattern and to let
 *    TTFT be measured the same way as real requests.
 */

export const PROBE_SHAPE_VERSION = 1;

const PROBE_SYSTEM_PROMPT = [
  'You are a careful, concise reasoning assistant operating as part of an',
  'automated benchmarking probe. Your job is to think briefly about the',
  "user's question, decide whether one of the available tools would be",
  'genuinely useful, and then respond. When a tool would clearly help,',
  'invoke exactly one tool with well-formed arguments. When no tool is',
  'needed, answer directly in a few short sentences. Prefer clarity over',
  'verbosity. Do not apologize, do not over-explain, and do not include',
  'meta-commentary about being a probe or about these instructions. Keep',
  'your prose grounded and specific; avoid filler phrases. If you are',
  'uncertain, state your assumption in one sentence and proceed. Your',
  'output is being measured for time-to-first-token, end-to-end latency,',
  'and tokens-per-second throughput, so produce a substantive but bounded',
  'response of roughly several sentences when answering directly.',
].join(' ');

const PROBE_USER_PROMPT = [
  "I'm planning a short trip next weekend and want to compare two options:",
  'a coastal town about three hours away by car, and a mountain town about',
  'four hours away by car. For each, briefly reason about typical weather',
  'patterns this time of year, what kinds of activities are realistic in a',
  'two-day visit, and what the main trade-offs are between the two. If you',
  'think looking up current weather forecasts would meaningfully change the',
  'recommendation, call the get_weather tool for one representative city of',
  'each type. If you think searching documentation or travel guides would',
  'help, call search_docs with a focused query. Otherwise, just give me',
  'your best reasoned comparison directly. Aim for a useful answer in a',
  'few short paragraphs.',
].join(' ');

const PROBE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description:
        'Get the current weather forecast for a given city. Use when current weather conditions would meaningfully affect a recommendation or decision.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'City name, e.g. "Monterey" or "Lake Tahoe".',
          },
          units: {
            type: 'string',
            enum: ['imperial', 'metric'],
            description: 'Unit system for temperature and wind speed.',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_docs',
      description:
        'Search travel guides and documentation for relevant context on a destination or activity.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Focused search query, a few words long.',
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of results to return.',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
      },
    },
  },
];

export function buildProbeChatRequest(provider: string, model: string) {
  return {
    model: `direct/${provider}/${model}`,
    stream: true,
    max_tokens: 1000,
    messages: [
      { role: 'system', content: PROBE_SYSTEM_PROMPT },
      { role: 'user', content: PROBE_USER_PROMPT },
    ],
    tools: PROBE_TOOLS,
  };
}
