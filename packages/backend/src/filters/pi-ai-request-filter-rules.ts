import type { PiAiRequestFilterRule } from './pi-ai-request-filters';

export const PI_AI_REQUEST_FILTERS: PiAiRequestFilterRule[] = [
  {
    provider: 'openai-codex',
    model: 'gpt-5.2-codex',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.'
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.3-codex',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.'
  }
];
