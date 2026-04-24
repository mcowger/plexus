import type { PiAiRequestFilterRule } from './pi-ai-request-filters';

export const PI_AI_REQUEST_FILTERS: PiAiRequestFilterRule[] = [
  {
    provider: 'github-copilot',
    model: 'gpt-5.2',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'github-copilot',
    model: 'gpt-5.4',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'github-copilot',
    model: 'gpt-5.5',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'github-copilot',
    model: 'gpt-5.2-codex',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'github-copilot',
    model: 'gpt-5.3-codex',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'github-copilot',
    model: 'gpt-5.3-codex-spark',
    strippedParameters: ['temperature'],
    comment: 'GitHub Copilot rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.2',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.4',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.5',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.2-codex',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.3-codex',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
  {
    provider: 'openai-codex',
    model: 'gpt-5.3-codex-spark',
    strippedParameters: ['temperature'],
    comment: 'Codex OAuth rejects temperature for this model.',
  },
];
